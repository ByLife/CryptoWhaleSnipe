// src/autoload/paper.ts
//
// Paper trading of the COPY signals, with the exit rule from the research:
// no stop loss, take profit at x10, otherwise sell after 30 days.
// Every fresh COPY signal gets a position (regime ON or OFF, so we can compare
// both live); only the ON ones are broadcast on Discord.
// Prices: DexScreener (most liquid pair where the token is the base token).

import axios from "axios";
import Logger from "../logger";
import PaperTrade, { PaperTrade as PT } from "../database/models/PaperTrade";

export const paperConfig = () => ({
  tp: Number(process.env.PAPER_TP_MULTIPLE ?? 10),
  maxHoldDays: Number(process.env.PAPER_MAX_HOLD_DAYS ?? 30),
  cost: Number(process.env.PAPER_COST ?? 0.03), // round trip (fees + slippage)
  minLiqUsd: Number(process.env.PAPER_MIN_LIQ_USD ?? 1000),
  deadHours: Number(process.env.PAPER_DEAD_HOURS ?? 24),
  pendingMaxMinutes: Number(process.env.PAPER_PENDING_MAX_MINUTES ?? 60),
  everyMinutes: Number(process.env.PAPER_EVERY_MINUTES ?? 5),
});

export interface Quote {
  price: number;
  pair: string;
  liqUsd: number;
}

type TradeState = Pick<
  PT,
  | "status" | "buyAt" | "openedAt" | "entryPrice" | "pairAddress" | "lastPrice" | "lastPriceAt"
  | "maxMultiple" | "closedAt" | "exitPrice" | "exitReason" | "returnPct"
>;

/**
 * Pure: advance one position given the current quote (null = no usable price:
 * no pair, or liquidity below minLiqUsd). Returns the fields to update.
 */
export function stepTrade(
  t: TradeState,
  q: Quote | null,
  now: Date,
  cfg = paperConfig()
): Partial<TradeState> {
  const usable = q && q.price > 0 && q.liqUsd >= cfg.minLiqUsd ? q : null;
  if (t.status === "pending") {
    if (usable)
      return {
        status: "open", openedAt: now, entryPrice: usable.price, pairAddress: usable.pair,
        lastPrice: usable.price, lastPriceAt: now, maxMultiple: 1,
      };
    if (now.getTime() - new Date(t.buyAt).getTime() > cfg.pendingMaxMinutes * 60_000)
      return { status: "no_price" };
    return {};
  }
  if (t.status !== "open" || !t.entryPrice || !t.openedAt) return {};
  const close = (exitPrice: number, exitReason: "tp" | "time" | "dead") => ({
    status: "closed" as const, closedAt: now, exitPrice, exitReason,
    returnPct: exitPrice / t.entryPrice! - 1 - cfg.cost,
  });
  const upd: Partial<TradeState> = {};
  if (usable) {
    const m = usable.price / t.entryPrice;
    upd.lastPrice = usable.price;
    upd.lastPriceAt = now;
    upd.maxMultiple = Math.max(t.maxMultiple || 1, m);
    // TP = limit order at entry x tp
    if (m >= cfg.tp) return { ...upd, ...close(t.entryPrice * cfg.tp, "tp") };
  } else {
    const seen = new Date(t.lastPriceAt || t.openedAt).getTime();
    if (now.getTime() - seen > cfg.deadHours * 3600_000) return close(0, "dead"); // rugged / no liquidity
  }
  if (now.getTime() - new Date(t.openedAt).getTime() >= cfg.maxHoldDays * 86400_000)
    return { ...upd, ...close(upd.lastPrice ?? t.lastPrice ?? 0, "time") };
  return upd;
}

/** Most liquid DexScreener pair per token (token must be the pair's base token). */
export async function quotes(chain: string, tokens: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const dsChain = chain === "SOL" ? "solana" : "ethereum";
  for (let i = 0; i < tokens.length; i += 30) {
    const batch = tokens.slice(i, i + 30);
    try {
      const { data } = await axios.get(
        `https://api.dexscreener.com/tokens/v1/${dsChain}/${batch.join(",")}`,
        { timeout: 20000 }
      );
      for (const p of Array.isArray(data) ? data : []) {
        const base = String(p?.baseToken?.address || "");
        const key = batch.find((t) => t.toLowerCase() === base.toLowerCase());
        if (!key) continue;
        const q = { price: Number(p.priceUsd), pair: String(p.pairAddress), liqUsd: Number(p?.liquidity?.usd || 0) };
        const cur = out.get(key);
        if (q.price > 0 && (!cur || q.liqUsd > cur.liqUsd)) out.set(key, q);
      }
    } catch (err) {
      Logger.warn(`[PAPER] DexScreener failed: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

export async function updatePaperTrades(now = new Date()): Promise<void> {
  const cfg = paperConfig();
  const live = await PaperTrade.find({ status: { $in: ["pending", "open"] } });
  if (!live.length) return;
  const byChain = new Map<string, string[]>();
  for (const t of live) {
    const l = byChain.get(t.chain) || [];
    l.push(t.tokenAddress);
    byChain.set(t.chain, l);
  }
  const q = new Map<string, Quote>();
  for (const [chain, toks] of byChain)
    for (const [k, v] of await quotes(chain, [...new Set(toks)])) q.set(`${chain}:${k}`, v);
  for (const t of live) {
    const upd = stepTrade(t, q.get(`${t.chain}:${t.tokenAddress}`) || null, now, cfg);
    if (!Object.keys(upd).length) continue;
    Object.assign(t, upd);
    await t.save();
    if (upd.status === "open")
      Logger.info(`[PAPER] open ${t.tokenSymbol} @ ${t.entryPrice} (${t.regimeOn ? "regime ON" : "regime OFF"})`);
    if (upd.status === "closed")
      Logger.info(`[PAPER] close ${t.tokenSymbol} ${upd.exitReason} ${((upd.returnPct || 0) * 100).toFixed(0)}%`);
  }
}

export async function paperLoop(): Promise<void> {
  try {
    await updatePaperTrades();
  } catch (err) {
    Logger.error(`[PAPER] ${String(err)}`);
  }
  setTimeout(paperLoop, paperConfig().everyMinutes * 60_000);
}

/** Summary for the API / Discord: open positions + realized stats by regime. */
export async function paperSummary() {
  const all = await PaperTrade.find({ status: { $in: ["open", "closed"] } }).sort({ buyAt: -1 }).lean();
  const stats = (rows: typeof all) => {
    const closed = rows.filter((r) => r.status === "closed");
    const rets = closed.map((r) => r.returnPct || 0);
    const open = rows.filter((r) => r.status === "open");
    const unreal = open.map((r) => (r.lastPrice || 0) / (r.entryPrice || 1) - 1);
    return {
      closed: closed.length,
      open: open.length,
      meanReturn: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null,
      tpHits: closed.filter((r) => r.exitReason === "tp").length,
      dead: closed.filter((r) => r.exitReason === "dead").length,
      openMeanUnrealized: unreal.length ? unreal.reduce((a, b) => a + b, 0) / unreal.length : null,
    };
  };
  const alerted = (r: (typeof all)[number]) => r.regimeOn && r.qualified !== false;
  return {
    // what the Discord alerts did (regime ON + wallet qualified)
    regimeOn: stats(all.filter(alerted)),
    // regime ON but wallet below COPY_MIN_ROI
    regimeOnUnqualified: stats(all.filter((r) => r.regimeOn && r.qualified === false)),
    regimeOff: stats(all.filter((r) => !r.regimeOn)),
    open: all
      .filter((r) => r.status === "open")
      .slice(0, 25)
      .map((r) => ({
        tokenSymbol: r.tokenSymbol, tokenAddress: r.tokenAddress, chain: r.chain, username: r.username,
        regimeOn: r.regimeOn, qualified: r.qualified, openedAt: r.openedAt, entryPrice: r.entryPrice, lastPrice: r.lastPrice,
        multiple: (r.lastPrice || 0) / (r.entryPrice || 1), maxMultiple: r.maxMultiple,
      })),
  };
}
