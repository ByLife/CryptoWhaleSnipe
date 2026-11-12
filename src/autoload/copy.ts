// src/autoload/copy.ts
//
// COPY loop: the first buy of a token by a smart wallet becomes a COPY signal
// (one per token per cooldown) and, when fresh, a paper position. Two filters
// decide whether DreamBot broadcasts it, not whether it is recorded:
//   regimeOn  : alt-season regime ON
//   qualified : buyer's own realized ROI coefficient > COPY_MIN_ROI
// Paper-trading the filtered-out signals too tells us live whether the filters matter.

import Logger from "../logger";
import EthereumWallet from "../database/models/EtherWallet";
import EtherTransaction from "../database/models/EtherTransaction";
import SignalTransactions from "../database/models/SignalTransactions";
import PaperTrade from "../database/models/PaperTrade";
import { Buy, copyConfig, detectCopies, toBuy } from "./signals";
import { isRegimeOn } from "./regime";

const LOOKBACK_HOURS = 6;

export async function processCopies(now = new Date()): Promise<void> {
  const cfg = copyConfig();
  const smart = await EthereumWallet.find({ smart: true }).lean();
  if (!smart.length) return;
  const userOf = new Map<string, string>();
  for (const w of smart) for (const a of w.wallets || []) userOf.set(a.toLowerCase(), w.username);
  const roiOf = new Map<string, number | null>(smart.map((w) => [w.username, w.roiCoef ?? null]));
  const smartUsers = new Set(smart.map((w) => w.username));

  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000);
  const txs = await EtherTransaction.find({
    timestamp: { $gte: since },
    wallet: { $in: [...userOf.keys()] },
  }).lean();
  const buys: Buy[] = [];
  for (const tx of txs) {
    const wallet = String(tx.wallet || "").toLowerCase();
    const b = toBuy(tx, { chain: "ETH", username: userOf.get(wallet) || wallet, wallet, at: new Date(tx.timestamp!) });
    if (b) buys.push(b);
  }
  if (!buys.length) return;

  const recent = await SignalTransactions.find(
    { type: "copy", createdAt: { $gte: new Date(now.getTime() - cfg.cooldownDays * 86400_000) } },
    { chain: 1, tokenAddress: 1 }
  ).lean();
  const copied = new Set(recent.map((s) => `${s.chain}:${s.tokenAddress}`));
  const signals = detectCopies(buys, smartUsers, cfg, now, copied);
  if (!signals.length) return;

  const regimeOn = await isRegimeOn();
  for (const s of signals) {
    const walletRoi = roiOf.get(s.walletNames[0]) ?? null;
    // unknown coefficient (manual smart wallet) is trusted
    const qualified = walletRoi === null || walletRoi > cfg.minRoi;
    const doc = await SignalTransactions.create({
      ...s, type: "copy", nWallets: 1, regimeOn, walletRoi, qualified,
    });
    if (s.fresh)
      await PaperTrade.create({
        signalId: String(doc._id), chain: s.chain, tokenAddress: s.tokenAddress, tokenSymbol: s.tokenSymbol,
        username: s.walletNames[0], wallet: s.wallets[0], regimeOn, walletRoi, qualified,
        buyAt: s.signalAt, status: "pending",
      });
    Logger.info(
      `[COPY] ${s.fresh ? "NEW" : "late"} ${s.tokenSymbol} by ${s.walletNames[0]} $${Math.round(s.usdValue)} ` +
        `roi ${walletRoi ?? "?"} regime ${regimeOn ? "ON" : "OFF"} -> ${regimeOn && qualified ? "alert" : "paper only"}`
    );
  }
}

export async function copyLoop(): Promise<void> {
  try {
    await processCopies();
  } catch (err) {
    Logger.error(`[COPY] ${String(err)}`);
  }
  setTimeout(copyLoop, 30_000);
}
