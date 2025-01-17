// src/helpers/SolPrice.ts
import axios from "axios";

let cachedSolPrice = 20;    // Fallback if coinGecko is down
let lastPriceUpdate = 0;    // Track when we last updated

/**
 * Fetch the real-time SOL price from CoinGecko, caching for 5 minutes.
 */
export async function getSolPriceInUsd(): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  // If we updated in the last 5 minutes, return cached
  if ((nowSec - lastPriceUpdate) < (5 * 60) && cachedSolPrice > 0) {
    return cachedSolPrice;
  }

  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
    const res = await axios.get(url, { timeout: 5000 });
    const newPrice = res.data?.solana?.usd;
    if (newPrice) {
      cachedSolPrice = newPrice;
      lastPriceUpdate = nowSec;
    }
  } catch (err) {
    console.error("Error fetching SOL price from CoinGecko:", err);
  }

  return cachedSolPrice;
}