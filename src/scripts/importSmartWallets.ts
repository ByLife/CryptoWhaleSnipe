// src/scripts/importSmartWallets.ts
//
// Import the copy-bot wallets found by the research (DreamBot/research/
// export_smart_wallets.py) into EthereumWallet.
//   - address already tracked -> flag the existing document smart: true
//   - new address             -> new document {username: label, source, smart, status: pending}
// The daily status job then decides which ones are polled (active / standby / dormant).
// Usage: npx ts-node src/scripts/importSmartWallets.ts smart_wallets.csv [--dry]
// CSV columns: address,source,label[,roi_coef]  (re-running updates roiCoef)

import fs from "fs";
import mongoose from "mongoose";
import { config } from "../../config";
import EthereumWallet from "../database/models/EtherWallet";

export interface Row {
  address: string;
  source: string;
  label: string;
  roiCoef: number | null;
}

export function parseCsv(text: string): Row[] {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  const ia = cols.indexOf("address");
  const is = cols.indexOf("source");
  const il = cols.indexOf("label");
  const ir = cols.indexOf("roi_coef");
  if (ia < 0) throw new Error("CSV needs an 'address' column");
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const l of lines) {
    const c = l.split(",");
    const address = (c[ia] || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address) || seen.has(address)) continue;
    seen.add(address);
    out.push({
      address,
      source: (is >= 0 && c[is]?.trim()) || "research",
      label: (il >= 0 && c[il]?.trim()) || `smart-${address.slice(2, 8)}`,
      roiCoef: ir >= 0 && c[ir]?.trim() !== "" && Number.isFinite(Number(c[ir])) ? Number(c[ir]) : null,
    });
  }
  return out;
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error("usage: importSmartWallets.ts <csv> [--dry]");
  const dry = flag === "--dry";
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  await mongoose.connect(config.mongo.url);
  const docs = await EthereumWallet.find({}, { wallets: 1, username: 1, smart: 1 }).lean();
  const owner = new Map<string, any>();
  for (const d of docs) for (const a of d.wallets || []) owner.set(a.toLowerCase(), d);
  const usernames = new Set(docs.map((d) => d.username));
  let flagged = 0;
  let created = 0;
  for (const r of rows) {
    const d = owner.get(r.address);
    if (d) {
      if (!d.smart) flagged++;
      if (!dry) await EthereumWallet.updateOne({ _id: d._id }, { $set: { smart: true, roiCoef: r.roiCoef } });
      continue;
    }
    let username = r.label;
    for (let k = 2; usernames.has(username); k++) username = `${r.label}-${k}`;
    usernames.add(username);
    created++;
    if (!dry)
      await EthereumWallet.create({
        username, wallets: [r.address], influencer: false, smart: true, source: r.source, status: "pending",
        roiCoef: r.roiCoef,
      });
  }
  const pos = rows.filter((r) => (r.roiCoef ?? 0) > 0).length;
  console.log(`${rows.length} rows (${pos} with roi_coef > 0): ${flagged} existing wallets flagged smart, ${created} new wallets${dry ? " (dry run)" : ""}`);
  await mongoose.disconnect();
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
