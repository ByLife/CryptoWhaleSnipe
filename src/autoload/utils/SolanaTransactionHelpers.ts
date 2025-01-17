import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import * as BufferLayout from "buffer-layout";
import SolTransactionModel from "../../database/models/SolTransaction";
import Logger from "../../logger";
import dotenv from "dotenv";
dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const connection = new Connection("https://api.mainnet-beta.solana.com");

// For reading on-chain metadata
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// Timings
const API_TIMEOUT = 10000;
const RETRY_DELAY = 2000;
const METADATA_DELAY = 500;
const TX_DELAY = 1000;

// Rate limit for Helius calls: 10 requests/sec => ~100-110 ms
const HELIUS_RATE_LIMIT_MS = 110;
let lastHeliusCall = 0;

// Auto-fetch SOL price from CoinGecko every 1 min
const SOL_PRICE_FETCH_INTERVAL = 60_000;
let cachedSolPrice = 20;   // fallback
let lastSolPriceFetch = 0;

/*******************************************
 * METADATA decoding layout
 *******************************************/
const METADATA_LAYOUT = BufferLayout.struct([
  BufferLayout.u8("version"),
  BufferLayout.u8("initialized"),
  BufferLayout.u8("dataType"),
  BufferLayout.u8("tokenStandard"),
  BufferLayout.blob(32, "updateAuthority"),
  BufferLayout.blob(32, "mint"),
  BufferLayout.seq(BufferLayout.u8(), 32, "name"),
  BufferLayout.seq(BufferLayout.u8(), 10, "symbol"),
  BufferLayout.seq(BufferLayout.u8(), 200, "uri"),
]);

const tokenMetadataCache = new Map<string, any>();

/*******************************************
 * Utility: delay
 *******************************************/
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*******************************************
 * CoinGecko SOL Price fetching
 *******************************************/
async function fetchSolPriceFromCoinGecko() {
  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
    const resp = await axios.get(url, { timeout: API_TIMEOUT });
    const solPrice = resp.data?.solana?.usd;
    if (solPrice) {
      cachedSolPrice = solPrice;
      Logger.info(`Updated SOL price: $${solPrice}`);
    }
  } catch (error) {
    Logger.warn("Failed to fetch SOL price from CoinGecko, using fallback");
  }
}

async function getSolPrice(): Promise<number> {
  const now = Date.now();
  if (now - lastSolPriceFetch > SOL_PRICE_FETCH_INTERVAL) {
    lastSolPriceFetch = now;
    await fetchSolPriceFromCoinGecko();
  }
  return cachedSolPrice;
}

/*******************************************
 * fetchFromHelius(url)
 * respects 10 req/sec => wait 110ms if needed
 *******************************************/
async function fetchFromHelius(url: string) {
  const now = Date.now();
  const diff = now - lastHeliusCall;
  if (diff < HELIUS_RATE_LIMIT_MS) {
    await delay(HELIUS_RATE_LIMIT_MS - diff);
  }
  lastHeliusCall = Date.now();

  return axios.get(url, { timeout: API_TIMEOUT });
}

/*******************************************
 * processSolSwaps(address)
 *  - fetch "SWAP" from Helius
 *  - parse input => outTokens, output => inTokens
 *  - skip if totalUsdValue < 1000
 *  - skip if signature already in DB
 *  - store outTokens, inTokens, totalUsdValue
 *******************************************/
export async function processSolSwaps(address: string, maxPrice: number) {
  try {
    // 1) Rate-limited fetch from Helius
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}`;
    const heliusResp = await fetchFromHelius(url);
    const transactions = heliusResp?.data || [];

    if (!Array.isArray(transactions) || transactions.length === 0) {
      console.log(`No Helius TXs for ${address}`);
      return;
    }

    // 2) Filter only SWAP tx
    const swapTxs = transactions.filter(
      (tx: any) => tx.type === "SWAP" && tx.events?.swap
    );
    console.log(`=> Found ${swapTxs.length} SWAP tx for ${address}`);

    // get dynamic SOL price
    const currentSolPrice = await getSolPrice();

    let idx = 0;
    for (const tx of swapTxs) {
      idx++;
      console.log(`[${idx}/${swapTxs.length}] Checking SWAP: ${tx.signature}`);
      // minor delay to avoid spamming
      await delay(300);

      try {
        const swapEvent = tx.events.swap;
        // Input => outTokens, Output => inTokens
        const inputMint = swapEvent.tokenInputs?.[0]?.mint || "SOL";
        const outputMint = swapEvent.tokenOutputs?.[0]?.mint || "SOL";

        // small delay before metadata
        await delay(METADATA_DELAY);

        const [inputMeta, outputMeta] = await Promise.all([
          getTokenMetadata(inputMint),
          getTokenMetadata(outputMint),
        ]);

        const inputAmount = calculateAmount(
          swapEvent.tokenInputs?.[0],
          swapEvent.nativeInput,
          inputMeta.decimals
        );
        const outputAmount = calculateAmount(
          swapEvent.tokenOutputs?.[0],
          swapEvent.nativeOutput,
          outputMeta.decimals
        );

        // Log
        const dateStr = new Date(tx.timestamp * 1000).toLocaleString();
        const ratio = outputAmount ? (inputAmount / outputAmount) : 0;

        console.log("\n------------------------");
        console.log(`SWAP | ${dateStr}`);
        console.log(
          `${inputAmount.toFixed(4)} ${inputMeta.symbol} (${inputMeta.name}) `
          + `→ ${outputAmount.toFixed(4)} ${outputMeta.symbol} (${outputMeta.name})`
        );
        if (ratio > 0) {
          console.log(`Price: 1 ${outputMeta.symbol} = ${formatPrice(ratio, inputMeta.symbol)}`);
        }
        console.log(`Source: ${tx.source || "Unknown"}`);
        console.log(`TX: ${tx.signature}`);
        if (outputMint !== "SOL") {
          console.log(`Token Info: https://solscan.io/token/${outputMint}`);
        }

        // build outTokens / inTokens
        let outTokens = [{
          symbol: inputMeta.symbol,
          amount: inputAmount,
          usdValue: (inputMeta.symbol === "SOL") ? inputAmount * currentSolPrice : 0,
        }];
        let inTokens = [{
          symbol: outputMeta.symbol,
          amount: outputAmount,
          usdValue: (outputMeta.symbol === "SOL") ? outputAmount * currentSolPrice : 0,
        }];

        // totalUsdValue => if side is SOL
        let totalUsdValue = 0;
        if (inputMeta.symbol === "SOL") {
          totalUsdValue = Math.max(totalUsdValue, inputAmount * currentSolPrice);
        }
        if (outputMeta.symbol === "SOL") {
          totalUsdValue = Math.max(totalUsdValue, outputAmount * currentSolPrice);
        }

        // skip if < 1000
        if (totalUsdValue < maxPrice) {
          console.log(`=> totalUsdValue=$${totalUsdValue.toFixed(2)} < 1000, skipping`);
          continue;
        }

        // check if already in DB
        const existing = await SolTransactionModel.findOne({ signature: tx.signature });
        if (existing) {
          console.log(`Skipping. Tx with signature=${tx.signature} is already stored.`);
          continue; // no error
        }

        // insert


        await SolTransactionModel.create({
          signature: tx.signature,
          blockTime: tx.timestamp,
          slot: tx.slot || 0,

          // store the outTokens/inTokens
          outTokens,
          inTokens,
          totalUsdValue,

          contractAddress: outputMint,
        

          from: address,
          to: address,
          type: "swap",
        });

        console.log(`Saved swap tx: ${tx.signature} (usdValue=$${totalUsdValue.toFixed(2)})`);
        await delay(TX_DELAY);

      } catch (err) {
        console.error("Error processing swap tx:", err);
        Logger.error(`Error processing swap ${tx.signature}: ${String(err)}`);
      }
    }
  } catch (err) {
    console.error("Erreur récupération swaps:", err);
    await delay(RETRY_DELAY);
  }
}

/***************************************
 * getTokenMetadata
 ***************************************/
async function getTokenMetadata(mintAddress: string) {
  try {
    if (!mintAddress || mintAddress === "SOL") {
      return { decimals: 9, symbol: "SOL", name: "Solana" };
    }
    if (tokenMetadataCache.has(mintAddress)) {
      return tokenMetadataCache.get(mintAddress);
    }

    const mintPubkey = new PublicKey(mintAddress);
    const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
    const parsedData = accountInfo.value?.data;
    const basicInfo: any =
      parsedData && "parsed" in parsedData ? parsedData.parsed?.info : { decimals: 9 };

    try {
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      const metadataInfo = await connection.getAccountInfo(metadataPDA);
      if (metadataInfo) {
        const metadata = METADATA_LAYOUT.decode(metadataInfo.data);
        const name = Buffer.from(metadata.name).toString("utf8").replace(/\0/g, "");
        const symbol = Buffer.from(metadata.symbol).toString("utf8").replace(/\0/g, "");

        const tokenInfo = {
          decimals: basicInfo.decimals,
          symbol: symbol || mintAddress,
          name: name || `Token ${mintAddress}`,
        };
        tokenMetadataCache.set(mintAddress, tokenInfo);
        return tokenInfo;
      }
    } catch (err) {
      console.warn(`Metadata error for ${mintAddress}:`, err);
    }

    const tokenInfo = {
      decimals: basicInfo.decimals,
      symbol: mintAddress,
      name: `Token ${mintAddress}`,
    };
    tokenMetadataCache.set(mintAddress, tokenInfo);
    return tokenInfo;
  } catch (error) {
    console.warn(`Error token info for ${mintAddress}:`, error);
    return { decimals: 9, symbol: mintAddress, name: `Unknown Token ${mintAddress}` };
  }
}

/***************************************
 * calculateAmount
 ***************************************/
function calculateAmount(tokenData: any, nativeData: any, decimals: number) {
  if (nativeData) {
    // e.g. user is sending or receiving native SOL
    return nativeData.amount / 1e9;
  }
  if (tokenData?.rawTokenAmount) {
    return Number(tokenData.rawTokenAmount.tokenAmount) / Math.pow(10, decimals);
  }
  return 0;
}

/***************************************
 * formatPrice
 ***************************************/
function formatPrice(price: number, symbol: string) {
  if (price === 0) return "N/A";
  if (price < 0.000001) return `< 0.000001 ${symbol}`;
  return `${price.toFixed(6)} ${symbol}`;
}
