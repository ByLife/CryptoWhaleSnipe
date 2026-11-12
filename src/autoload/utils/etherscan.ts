// src/autoload/utils/etherscan.ts
//
// One shared Etherscan V2 client. The free tier allows ~5 calls/s per key and
// several loops now use it (tx fetching, wallet status, ...), so every call
// goes through the same throttle.

import axios from "axios";

const BASE = "https://api.etherscan.io/v2/api";
const RPS = Number(process.env.ETHERSCAN_RPS ?? 4);

let nextSlot = 0;
async function throttle(): Promise<void> {
  const gap = 1000 / RPS;
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + gap;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/**
 * GET an Etherscan V2 action on Ethereum mainnet. Returns `result` (array or
 * string). "No transactions found" -> []. Retries on rate limit / network errors.
 */
export async function etherscan(
  params: Record<string, string | number>,
  retries = 3
): Promise<any> {
  const apikey = process.env.ETH_APIKEY || "";
  const qs = new URLSearchParams({ chainid: "1", ...mapStr(params), apikey }).toString();
  for (let attempt = 1; attempt <= retries; attempt++) {
    await throttle();
    try {
      const { data } = await axios.get(`${BASE}?${qs}`, { timeout: 30000 });
      if (data?.status === "1" || Array.isArray(data?.result)) return data.result;
      const msg = String(data?.result ?? data?.message ?? "unknown error");
      if (/no transactions found|no records found/i.test(msg)) return [];
      if (/rate limit/i.test(msg) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(`Etherscan ${params.action}: ${msg}`);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return [];
}

function mapStr(p: Record<string, string | number>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) o[k] = String(v);
  return o;
}
