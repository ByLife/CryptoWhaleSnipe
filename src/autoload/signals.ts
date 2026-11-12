// src/autoload/signals.ts
//
// "Insider" signal = K distinct tracked wallets (grouped by username, so one
// person with several addresses counts once) BUY the same token, keyed by
// contract address, within WINDOW days. A token can't re-signal during
// COOLDOWN days. Only signals whose K-th buy is recent ("fresh") are meant to
// be broadcast; older ones are stored silently so a restart never spams.
//
// Defaults come from the research backtest in DreamBot/research and can be
// overridden with env vars.

export interface SignalConfig {
  minWallets: number;
  windowDays: number;
  cooldownDays: number;
  freshHours: number;
  minBuyUsd: number;
}

export const signalConfig = (): SignalConfig => ({
  // 2 wallets / 3 days: 3+ wallets fired ~10x in 21 months and entered after
  // a bigger run-up; see DreamBot/research for the numbers.
  minWallets: Number(process.env.SIGNAL_MIN_WALLETS ?? 2),
  windowDays: Number(process.env.SIGNAL_WINDOW_DAYS ?? 3),
  cooldownDays: Number(process.env.SIGNAL_COOLDOWN_DAYS ?? 30),
  freshHours: Number(process.env.SIGNAL_FRESH_HOURS ?? 6),
  minBuyUsd: Number(process.env.SIGNAL_MIN_BUY_USD ?? 1000),
});

export interface Buy {
  chain: "ETH" | "SOL";
  token: string; // contract address / mint (lowercased for ETH)
  symbol: string;
  username: string;
  wallet: string;
  usd: number;
  at: Date;
}

export interface DetectedSignal {
  chain: "ETH" | "SOL";
  tokenAddress: string;
  tokenSymbol: string;
  wallets: string[];
  walletNames: string[];
  usdValue: number;
  firstBuyAt: Date;
  signalAt: Date;
  fresh: boolean;
}

// Base assets: buying these is not a signal (and spending them is what makes
// a transaction a "buy").
export const ETH_BASE_ADDRESSES = new Set([
  "0xeth_native",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", // USDe
  "0x9d39a5de30e57443bff2a8307a4256c8797a3497", // sUSDe
  "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", // FDUSD
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8", // PYUSD
  "0xdc035d45d973e3ec169d2276ddab16f1e407384f", // USDS
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  "0x4fabb145d64652a948d72533023f6e7a623c7c53", // BUSD
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", // wstETH
  "0xae78736cd615f374d3085123a210448e74fc6393", // rETH
  "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee", // weETH
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
]);

export const BASE_SYMBOLS = new Set([
  "ETH", "WETH", "USDT", "USDC", "DAI", "USDE", "SUSDE", "FDUSD", "PYUSD",
  "USDS", "FRAX", "BUSD", "STETH", "WSTETH", "RETH", "WEETH", "WBTC", "CBBTC",
  "SOL", "WSOL", "UNKNOWN",
]);

interface TokenSide {
  address?: string;
  symbol?: string;
  usdValue?: number;
}

const isBase = (t: TokenSide) =>
  (t.address && ETH_BASE_ADDRESSES.has(t.address.toLowerCase())) ||
  BASE_SYMBOLS.has(String(t.symbol || "").toUpperCase());

/**
 * Turn one stored, wallet-relative transaction (outTokens left the tracked
 * wallet, inTokens entered it) into a Buy, or null if it isn't a clean
 * base -> single token purchase.
 */
export function toBuy(
  tx: { outTokens?: TokenSide[]; inTokens?: TokenSide[]; totalUsdValue?: number },
  meta: { chain: "ETH" | "SOL"; username: string; wallet: string; at: Date; fallbackToken?: string }
): Buy | null {
  const outs = tx.outTokens || [];
  const ins = tx.inTokens || [];
  if (!outs.length || !ins.length) return null;
  if (!outs.every(isBase)) return null; // rotations / sells are not buys
  const alts = ins.filter((t) => !isBase(t));
  if (alts.length !== 1) return null;
  const bought = alts[0];
  const token = (bought.address || meta.fallbackToken || "").toLowerCase();
  if (!token || token.startsWith("0xeth")) return null;
  const spent = outs.reduce((a, t) => a + (t.usdValue || 0), 0);
  const usd = spent || tx.totalUsdValue || 0;
  return {
    chain: meta.chain,
    token: meta.chain === "SOL" ? bought.address || meta.fallbackToken || token : token,
    symbol: String(bought.symbol || "UNKNOWN"),
    username: meta.username,
    wallet: meta.wallet,
    usd,
    at: meta.at,
  };
}

export interface Sell {
  chain: "ETH" | "SOL";
  token: string;
  username: string;
  wallet: string;
  usd: number;
  at: Date;
}

/**
 * A SELL (or move-out) of exactly one non-base token. Token -> native ETH
 * sales show no incoming token (the ETH comes back as an internal tx), so an
 * empty inTokens list still counts; sending to a CEX counts too, since it's
 * the usual first step of selling.
 */
export function toSell(
  tx: { outTokens?: TokenSide[]; inTokens?: TokenSide[]; totalUsdValue?: number },
  meta: { chain: "ETH" | "SOL"; username: string; wallet: string; at: Date; fallbackToken?: string }
): Sell | null {
  const outs = tx.outTokens || [];
  const ins = tx.inTokens || [];
  const alts = outs.filter((t) => !isBase(t));
  if (alts.length !== 1 || !ins.every(isBase)) return null;
  const sold = alts[0];
  const token = sold.address || meta.fallbackToken || "";
  if (!token) return null;
  return {
    chain: meta.chain,
    token: meta.chain === "ETH" ? token.toLowerCase() : token,
    username: meta.username,
    wallet: meta.wallet,
    usd: sold.usdValue || tx.totalUsdValue || 0,
    at: meta.at,
  };
}

export interface OpenSignal {
  id: string;
  chain: "ETH" | "SOL";
  tokenAddress: string;
  tokenSymbol: string;
  walletNames: string[];
  signalAt: Date;
}

export interface DetectedExit {
  parentSignal: string;
  chain: "ETH" | "SOL";
  tokenAddress: string;
  tokenSymbol: string;
  seller: string;
  usdValue: number;
  signalAt: Date; // when the exit happened
  fresh: boolean;
}

/**
 * Exit alert = the FIRST sell of the signaled token by any wallet that was
 * part of the buy signal. In the research backtest, copying these exits was
 * the only way the signal stayed profitable out-of-sample.
 */
export function detectExits(
  open: OpenSignal[],
  sells: Sell[],
  cfg: Pick<SignalConfig, "freshHours">,
  now: Date,
  alreadyExited: Set<string> = new Set()
): DetectedExit[] {
  const out: DetectedExit[] = [];
  for (const s of open) {
    if (alreadyExited.has(s.id)) continue;
    const members = new Set(s.walletNames);
    const first = sells
      .filter(
        (x) =>
          x.chain === s.chain &&
          x.token === s.tokenAddress &&
          members.has(x.username) &&
          x.at.getTime() > s.signalAt.getTime()
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    if (!first) continue;
    out.push({
      parentSignal: s.id,
      chain: s.chain,
      tokenAddress: s.tokenAddress,
      tokenSymbol: s.tokenSymbol,
      seller: first.username,
      usdValue: first.usd,
      signalAt: first.at,
      fresh: now.getTime() - first.at.getTime() <= cfg.freshHours * 3600_000,
    });
  }
  return out;
}

/**
 * Pure signal detection. `recentlySignaled` holds tokens already signaled
 * inside the cooldown (from the DB). Returns at most one signal per token.
 */
export function detectSignals(
  buys: Buy[],
  cfg: SignalConfig,
  now: Date,
  recentlySignaled: Set<string> = new Set()
): DetectedSignal[] {
  const windowMs = cfg.windowDays * 86400_000;
  const freshMs = cfg.freshHours * 3600_000;
  const byToken = new Map<string, Buy[]>();
  for (const b of buys) {
    if (b.usd < cfg.minBuyUsd) continue;
    const key = `${b.chain}:${b.token}`;
    if (recentlySignaled.has(key)) continue;
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key)!.push(b);
  }

  const out: DetectedSignal[] = [];
  for (const list of byToken.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let lo = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i].at.getTime();
      while (list[lo].at.getTime() < t - windowMs) lo++;
      const win = list.slice(lo, i + 1);
      const users = new Set(win.map((b) => b.username));
      const isNewUser = !list.slice(lo, i).some((b) => b.username === list[i].username);
      if (users.size >= cfg.minWallets && isNewUser) {
        out.push({
          chain: list[i].chain,
          tokenAddress: list[i].token,
          tokenSymbol: list[i].symbol,
          wallets: [...new Set(win.map((b) => b.wallet))],
          walletNames: [...users],
          usdValue: win.reduce((a, b) => a + b.usd, 0),
          firstBuyAt: win[0].at,
          signalAt: list[i].at,
          fresh: now.getTime() - t <= freshMs,
        });
        break; // one signal per token per cooldown period
      }
    }
  }
  return out;
}

export interface CopyConfig {
  minRoi: number;
  minBuyUsd: number;
  cooldownDays: number;
  freshMinutes: number;
}

export const copyConfig = (): CopyConfig => ({
  // wallet's own realized $-ROI coefficient must be above this to ALERT.
  // Backtest (regime ON, first smart buyer of the token): all wallets +23% / +16%
  // per trade (2023-24 / 2025-26), roiCoef > 0: +38% / +63%.
  minRoi: Number(process.env.COPY_MIN_ROI ?? 0),
  // research copied every buy >= $300 of the smart wallets
  minBuyUsd: Number(process.env.COPY_MIN_BUY_USD ?? 300),
  cooldownDays: Number(process.env.COPY_COOLDOWN_DAYS ?? 30),
  // entry speed matters: +1 min entries beat +1 h entries in the backtest
  freshMinutes: Number(process.env.COPY_FRESH_MINUTES ?? 60),
});

/**
 * COPY signal = a buy by ONE smart wallet (no consensus needed: k>=2 did not
 * beat k=1 in the backtest). One signal per token per cooldown, on its first
 * qualifying buy. Pure; `recentlyCopied` = tokens copied inside the cooldown.
 */
export function detectCopies(
  buys: Buy[],
  smartUsers: Set<string>,
  cfg: CopyConfig,
  now: Date,
  recentlyCopied: Set<string> = new Set()
): DetectedSignal[] {
  const first = new Map<string, Buy>();
  for (const b of buys) {
    if (!smartUsers.has(b.username) || b.usd < cfg.minBuyUsd) continue;
    const key = `${b.chain}:${b.token}`;
    if (recentlyCopied.has(key)) continue;
    const cur = first.get(key);
    if (!cur || b.at < cur.at) first.set(key, b);
  }
  return [...first.values()].map((b) => ({
    chain: b.chain,
    tokenAddress: b.token,
    tokenSymbol: b.symbol,
    wallets: [b.wallet],
    walletNames: [b.username],
    usdValue: b.usd,
    firstBuyAt: b.at,
    signalAt: b.at,
    fresh: now.getTime() - b.at.getTime() <= cfg.freshMinutes * 60_000,
  }));
}
