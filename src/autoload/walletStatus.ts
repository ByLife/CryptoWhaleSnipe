// src/autoload/walletStatus.ts
//
// Daily job: for every Ethereum wallet document, measure the cash still on its
// addresses (ETH + WETH/USDC/USDT/DAI) and the last transaction it SENT
// (received txs are ignored: airdrop/poisoning spam makes dead wallets look
// alive). Then decide which wallets the tx loop polls:
//   dormant : nothing sent for DORMANT_DAYS and < DORMANT_MIN_CASH_USD
//   active  : the MAX_ACTIVE_WALLETS best of the rest (influencers and manual
//             wallets first, then the most recently active)
//   standby : alive but over the cap (re-ranked every day)
// Nothing is deleted: a dormant wallet that sends a tx or gets funded again
// comes back at the next check.

import Logger from "../logger";
import EthereumWallet, { WalletStatus } from "../database/models/EtherWallet";
import { etherscan } from "./utils/etherscan";
import { getEthUsdPrice } from "./utils/EthTransactionHelpers";

export const statusConfig = () => ({
  dormantDays: Number(process.env.DORMANT_DAYS ?? 180),
  dormantMinCashUsd: Number(process.env.DORMANT_MIN_CASH_USD ?? 1000),
  maxActive: Number(process.env.MAX_ACTIVE_WALLETS ?? 200),
  everyHours: Number(process.env.WALLET_STATUS_EVERY_HOURS ?? 24),
});

const STABLES: [string, number, boolean][] = [
  // address, decimals, priced in ETH
  ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18, true], // WETH
  ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, false], // USDC
  ["0xdac17f958d2ee523a2206206994597c13d831ec7", 6, false], // USDT
  ["0x6b175474e89094c44da98b954eedeac495271d0f", 18, false], // DAI
];

export interface WalletFacts {
  id: string;
  influencer: boolean;
  smart: boolean;
  source: string;
  cashUsd: number | null;
  lastSentAt: Date | null;
}

/** Pure: dormant or alive (alive wallets are then ranked by rankWallets). */
export function isDormant(
  f: Pick<WalletFacts, "influencer" | "cashUsd" | "lastSentAt">,
  now: Date,
  cfg = statusConfig()
): boolean {
  if (f.influencer) return false;
  const idleDays = f.lastSentAt ? (now.getTime() - f.lastSentAt.getTime()) / 86400_000 : Infinity;
  return idleDays > cfg.dormantDays && (f.cashUsd ?? 0) < cfg.dormantMinCashUsd;
}

/** Pure: final status of every wallet, honouring the active cap. */
export function rankWallets(
  facts: WalletFacts[],
  now: Date,
  cfg = statusConfig()
): Map<string, WalletStatus> {
  const out = new Map<string, WalletStatus>();
  const alive = facts.filter((f) => {
    const d = isDormant(f, now, cfg);
    if (d) out.set(f.id, "dormant");
    return !d;
  });
  const prio = (f: WalletFacts) => (f.influencer ? 0 : f.source === "manual" ? 1 : 2);
  alive.sort(
    (a, b) =>
      prio(a) - prio(b) ||
      (b.lastSentAt?.getTime() ?? 0) - (a.lastSentAt?.getTime() ?? 0) ||
      (b.cashUsd ?? 0) - (a.cashUsd ?? 0)
  );
  alive.forEach((f, i) => out.set(f.id, i < cfg.maxActive ? "active" : "standby"));
  return out;
}

async function lastSent(address: string): Promise<Date | null> {
  // newest 100 normal txs, keep the first one sent by the address
  const res = await etherscan({
    module: "account", action: "txlist", address, startblock: 0, endblock: 99999999,
    page: 1, offset: 100, sort: "desc",
  });
  const tx = (Array.isArray(res) ? res : []).find(
    (t: any) => String(t.from).toLowerCase() === address.toLowerCase()
  );
  return tx ? new Date(Number(tx.timeStamp) * 1000) : null;
}

async function cashOf(addresses: string[], ethUsd: number): Promise<number> {
  let usd = 0;
  for (let i = 0; i < addresses.length; i += 20) {
    const res = await etherscan({
      module: "account", action: "balancemulti", address: addresses.slice(i, i + 20).join(","), tag: "latest",
    });
    for (const r of Array.isArray(res) ? res : []) usd += (Number(r.balance) / 1e18) * ethUsd;
  }
  for (const a of addresses)
    for (const [token, dec, inEth] of STABLES) {
      const raw = await etherscan({
        module: "account", action: "tokenbalance", contractaddress: token, address: a, tag: "latest",
      });
      const amt = Number(raw) / 10 ** dec;
      if (amt > 0) usd += inEth ? amt * ethUsd : amt;
    }
  return usd;
}

export async function refreshWalletStatus(): Promise<void> {
  const cfg = statusConfig();
  const now = new Date();
  const docs = await EthereumWallet.find();
  const ethUsd = await getEthUsdPrice();
  // pending (just imported) first, then the oldest checks
  docs.sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      (a.statusCheckedAt?.getTime() ?? 0) - (b.statusCheckedAt?.getTime() ?? 0)
  );
  let n = 0;
  for (const w of docs) {
    try {
      const addrs = (w.wallets || []).map((a) => a.toLowerCase());
      let sent: Date | null = null;
      for (const a of addrs) {
        const s = await lastSent(a);
        if (s && (!sent || s > sent)) sent = s;
      }
      w.lastSentAt = sent;
      // cash only decides between dormant and alive: skip the 5 calls per
      // address when the wallet sent something recently anyway
      const idle = !sent || now.getTime() - sent.getTime() > cfg.dormantDays * 86400_000;
      if (idle && ethUsd) w.cashUsd = await cashOf(addrs, ethUsd);
      w.statusCheckedAt = new Date();
      await w.save();
      if (++n % 25 === 0) Logger.info(`[WALLET STATUS] ${n}/${docs.length} checked`);
    } catch (err) {
      Logger.warn(`[WALLET STATUS] ${w.username}: ${String(err)}`);
    }
  }
  // never-checked wallets (every call failed, e.g. Etherscan down) keep their
  // status: an outage must not mark the whole list dormant
  const checked = docs.filter((w) => w.statusCheckedAt);
  if (checked.length < docs.length)
    Logger.warn(`[WALLET STATUS] ${docs.length - checked.length} wallets never checked, status unchanged`);
  const facts: WalletFacts[] = checked.map((w) => ({
    id: String(w._id),
    influencer: Boolean(w.influencer),
    smart: Boolean(w.smart),
    source: w.source || "manual",
    cashUsd: w.cashUsd ?? null,
    lastSentAt: w.lastSentAt ?? null,
  }));
  const status = rankWallets(facts, now, cfg);
  const ops = [...status].map(([id, s]) => ({
    updateOne: { filter: { _id: id }, update: { $set: { status: s } } },
  }));
  if (ops.length) await EthereumWallet.bulkWrite(ops);
  const count = (s: string) => [...status.values()].filter((x) => x === s).length;
  Logger.success(
    `[WALLET STATUS] active ${count("active")}, standby ${count("standby")}, dormant ${count("dormant")}`
  );
}

/** Query used by the tx loop: active wallets + legacy docs never checked. */
export const POLLED_WALLETS = {
  $or: [{ status: "active" }, { status: { $exists: false } }, { status: null }],
};

export async function walletStatusLoop(): Promise<void> {
  const cfg = statusConfig();
  try {
    await refreshWalletStatus();
  } catch (err) {
    Logger.error(`[WALLET STATUS] ${String(err)}`);
  }
  setTimeout(walletStatusLoop, cfg.everyHours * 3600_000);
}
