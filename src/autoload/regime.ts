// src/autoload/regime.ts
//
// Market regime that switches the copy bot ON / OFF.
// Research (DreamBot/research, 2023-2026, swap-by-swap backtest): copying the
// smart wallets only paid during a real alt season:
//   altsUp(D) = more than half of a 50-coin alt basket closed above its 50-day
//               average on D-1 (point-in-time: yesterday's close only)
//   ON        = altsUp for REGIME_STREAK_DAYS (21) days in a row
// copy every buy, TP x10 else exit at 30d: +23%/trade in 2023-24 and +16% in
// 2025-26 when ON, negative otherwise.

import axios from "axios";
import Logger from "../logger";
import Regime, { RegimeDay } from "../database/models/Regime";

export const ALTS = [
  "ethereum", "solana", "binancecoin", "ripple", "cardano", "dogecoin", "avalanche-2", "chainlink",
  "polkadot", "tron", "shiba-inu", "litecoin", "uniswap", "near", "aptos", "arbitrum", "optimism",
  "injective-protocol", "render-token", "fetch-ai", "sui", "sei-network", "celestia", "pepe", "bonk",
  "dogwifcoin", "floki", "the-graph", "aave", "maker", "stellar", "hedera-hashgraph", "cosmos",
  "filecoin", "internet-computer", "immutable-x", "blockstack", "kaspa", "theta-token", "algorand",
  "ethereum-name-service", "lido-dao", "thorchain", "gala", "the-sandbox", "decentraland",
  "axie-infinity", "mantle", "worldcoin-wld", "bitcoin-cash",
];

export const regimeConfig = () => ({
  streakDays: Number(process.env.REGIME_STREAK_DAYS ?? 21),
  maDays: 50,
  maMinDays: 40,
  // auto | on | off  (manual override, e.g. to test the alert pipeline)
  force: String(process.env.REGIME_FORCE ?? "auto").toLowerCase(),
  everyHours: Number(process.env.REGIME_EVERY_HOURS ?? 6),
});

const DAY = 86400;
type Series = { t: number; price: number }[]; // t in seconds

/**
 * Pure: daily regime from daily closes. Mirrors research/regime.py
 * (daily floor, forward-fill up to 5 days, 50d MA with >= 40 points,
 * indicator shifted by one day).
 */
export function computeRegime(
  closes: Record<string, Series>,
  fromDay: number,
  toDay: number,
  cfg = regimeConfig()
): RegimeDay[] {
  const days: number[] = [];
  for (let d = fromDay; d <= toDay; d += DAY) days.push(d);
  // daily matrix with ffill(limit 5)
  const cols: (number | null)[][] = [];
  for (const s of Object.values(closes)) {
    const byDay = new Map<number, number>();
    for (const p of s) if (p.price > 0) byDay.set(Math.floor(p.t / DAY) * DAY, p.price);
    let last: number | null = null;
    let age = 0;
    cols.push(
      days.map((d) => {
        const v = byDay.get(d);
        if (v !== undefined) {
          last = v;
          age = 0;
          return v;
        }
        age++;
        return last !== null && age <= 5 ? last : null;
      })
    );
  }
  // raw indicator per day (close of that day)
  const raw: { share: number; n: number }[] = days.map((_, i) => {
    let above = 0;
    let n = 0;
    for (const c of cols) {
      const v = c[i];
      if (v === null) continue;
      const win = c.slice(Math.max(0, i - cfg.maDays + 1), i + 1).filter((x): x is number => x !== null);
      if (win.length < cfg.maMinDays) continue;
      const ma = win.reduce((a, b) => a + b, 0) / win.length;
      n++;
      if (v > ma) above++;
    }
    return { share: n ? above / n : 0, n };
  });
  // shift by one day, then the streak
  const out: RegimeDay[] = [];
  let streak = 0;
  for (let i = 1; i < days.length; i++) {
    const { share, n } = raw[i - 1];
    const altsUp = n > 0 && share > 0.5;
    streak = altsUp ? streak + 1 : 0;
    out.push({
      day: new Date(days[i] * 1000),
      share,
      altsUp,
      streak,
      on: streak >= cfg.streakDays,
      nCoins: n,
    });
  }
  return out;
}

export async function fetchCloses(fromTs: number, nDays: number): Promise<Record<string, Series>> {
  const out: Record<string, Series> = {};
  // DefiLlama caps a request at 500 data points (coins x days)
  const per = Math.max(1, Math.floor(500 / nDays));
  for (let i = 0; i < ALTS.length; i += per) {
    const keys = ALTS.slice(i, i + per).map((c) => `coingecko:${c}`);
    try {
      const { data } = await axios.get(
        `https://coins.llama.fi/chart/${keys.join(",")}?start=${fromTs}&span=${nDays}&period=1d`,
        { timeout: 30000 }
      );
      for (const [k, v] of Object.entries<any>(data?.coins || {}))
        out[k] = (v.prices || []).map((p: any) => ({ t: Number(p.timestamp), price: Number(p.price) }));
    } catch (err) {
      Logger.warn(`[REGIME] price fetch failed for ${keys[0]}..: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}

/** Recompute the last ~4 months and upsert them. Returns today's regime. */
export async function refreshRegime(now = new Date()): Promise<RegimeDay | null> {
  const cfg = regimeConfig();
  const today = Math.floor(now.getTime() / 1000 / DAY) * DAY;
  // 50d MA + streak history + margin
  const nDays = cfg.maDays + 70;
  const from = today - nDays * DAY;
  const closes = await fetchCloses(from, nDays + 1);
  if (Object.keys(closes).length < 25) throw new Error(`only ${Object.keys(closes).length} coins priced`);
  // the first ~40 days lack MA history: never overwrite stored days with them
  const days = computeRegime(closes, from, today, cfg).filter((d) => d.nCoins >= 25);
  if (!days.length) throw new Error("no day with enough priced coins");
  await Regime.bulkWrite(
    days.map((d) => ({ updateOne: { filter: { day: d.day }, update: { $set: d }, upsert: true } }))
  );
  const last = days[days.length - 1] || null;
  if (last)
    Logger.info(
      `[REGIME] ${last.day.toISOString().slice(0, 10)} altsUp=${last.altsUp} ` +
        `(${(last.share * 100).toFixed(0)}% of ${last.nCoins} alts) streak=${last.streak} -> ${last.on ? "ON" : "OFF"}`
    );
  return last;
}

/** Is the bot ON right now? (manual override first, then the latest stored day) */
export async function isRegimeOn(): Promise<boolean> {
  const cfg = regimeConfig();
  if (cfg.force === "on") return true;
  if (cfg.force === "off") return false;
  const last = await Regime.findOne().sort({ day: -1 }).lean();
  return Boolean(last?.on);
}

export async function regimeLoop(): Promise<void> {
  try {
    await refreshRegime();
  } catch (err) {
    Logger.error(`[REGIME] ${String(err)}`);
  }
  setTimeout(regimeLoop, regimeConfig().everyHours * 3600_000);
}
