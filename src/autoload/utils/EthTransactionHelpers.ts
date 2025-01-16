import axios from "axios";
import EtherTransaction from "../../database/models/EtherTransaction";
import Logger from "../../logger";

// --------------- A simple delay ---------------
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------- Fetch Etherscan tokenTx ---------------

export async function fetchEtherscanTxs(address: string, ethApiKey: string, retryCount = 3): Promise<any[]> {
    const url =
    `https://api.etherscan.io/api` +
    `?module=account&action=tokentx&address=${address}` +
    `&startblock=0&endblock=99999999&sort=desc` +
    `&apikey=${ethApiKey}`;


  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await axios.get(url);
      if (response?.data?.result) {
        return response.data.result;
      }
      return [];
    } catch (err: any) {
      console.error(`Attempt #${attempt} for Etherscan tokenTx failed.`, err.message);
      // If it's the last attempt, rethrow the error so upper layer can catch
      if (attempt === retryCount) {
        throw err;
      }
      // Otherwise wait a bit and retry
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  return [];
}

// --------------- Fetch Ethplorer data for a given tx ---------------
export async function fetchEthplorerData(txHash: string, ethplorerApiKey: string): Promise<any | null> {
  const ethplorerUrl = `https://api.ethplorer.io/getTxInfo/${txHash}?apiKey=${ethplorerApiKey}`;
  try {
    const res = await axios.get(ethplorerUrl);
    return res?.data || null;
  } catch (err) {
    console.error(`Failed Ethplorer for tx ${txHash}`, err);
    return null;
  }
}

// --------------- Parse ERC-20 ops + top-level ETH ---------------
export function parseTokenOperations(
  txData: any,
  userAddr: string,
  realFrom: string,
  realTo: string,
  realValueETH: number
): {
  tokenOperations: Map<string, {
    symbol: string;
    decimals: number;
    price: number;
    marketCapUsd: number;     
    totalOut: number;
    totalIn: number;
    operations: any[];
  }>;
  spentEthAmount: number;
} {
  const userIsSender = (realFrom === userAddr);
  let spentEthAmount = 0;

  // We'll store (symbol, decimals, price, marketCapUsd, totalOut, totalIn, operations)
  const tokenOperations = new Map<string, {
    symbol: string;
    decimals: number;
    price: number;
    marketCapUsd: number;
    totalOut: number;
    totalIn: number;
    operations: any[];
  }>();

  // If user is sender with top-level ETH
  if (userIsSender && realValueETH > 0) {
    spentEthAmount = realValueETH;
    const fallbackEthPrice = 1700;
    tokenOperations.set("0xETH_NATIVE", {
      symbol: "ETH",
      decimals: 18,
      price: fallbackEthPrice,
      marketCapUsd: 0,    // No direct marketcap here unless you want to add
      totalOut: realValueETH,
      totalIn: 0,
      operations: []
    });
  }

  // If user is receiver of top-level ETH
  if (!userIsSender && realTo === userAddr && realValueETH > 0) {
    const fallbackEthPrice = 1700;
    tokenOperations.set("0xETH_NATIVE", {
      symbol: "ETH",
      decimals: 18,
      price: fallbackEthPrice,
      marketCapUsd: 0,    
      totalOut: 0,
      totalIn: realValueETH,
      operations: []
    });
  }

  // Now parse the ERC-20 operations
  const operations = txData.operations || [];
  for (const op of operations) {
    const tokenAddr = op.tokenInfo?.address?.toLowerCase();
    if (!tokenAddr) continue;

    if (!tokenOperations.has(tokenAddr)) {
      tokenOperations.set(tokenAddr, {
        symbol: op.tokenInfo?.symbol || "UNKNOWN",
        decimals: op.tokenInfo?.decimals ? Number(op.tokenInfo.decimals) : 18,
        price: op.tokenInfo?.price?.rate || 0,
        marketCapUsd: op.tokenInfo?.price?.marketCapUsd || 0, // <--
        totalOut: 0,
        totalIn: 0,
        operations: []
      });
    }

    const tOp = tokenOperations.get(tokenAddr)!;
    tOp.operations.push(op);

    const numericValue = parseFloat(op.value) / (10 ** tOp.decimals);

    // If op.from is user => out
    if ((op.from || "").toLowerCase() === userAddr) {
      tOp.totalOut += numericValue;
    }
    // If op.to is user => in
    if ((op.to || "").toLowerCase() === userAddr) {
      tOp.totalIn += numericValue;
    }
  }

  return { tokenOperations, spentEthAmount };
}

// --------------- Classify + pick single token + sum up USD ---------------
export function classifyTransaction(
  tokenOperations: Map<string, {
    symbol: string;
    decimals: number;
    price: number;
    marketCapUsd: number;
    totalOut: number;
    totalIn: number;
    operations: any[];
  }>,
  operations: any[],
  userAddr: string,
  spentEthAmount: number,
  realFrom: string
): {
  type: string;
  tokenDetails: {
    outTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    inTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    finalToken: null | { symbol: string; amount: number; usdValue: number; marketCapUsd: number };
  };
  outSymbols: string[];
  inSymbols: string[];
  totalUsdValue: number;

  // NEW: single token fields
  chosenTokenUsdValue: number;
  chosenTokenMarketCap: number;
} {
  let type = "unknown";
  const userIsSender = (realFrom === userAddr);

  // Build tokenDetails
  const tokenDetails = {
    outTokens: [] as { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[],
    inTokens: [] as { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[],
    finalToken: null as null | { symbol: string; amount: number; usdValue: number; marketCapUsd: number }
  };

  // Summarize out/in
  for (const [addr, data] of tokenOperations) {
    // outTokens
    if (data.totalOut > 0) {
      tokenDetails.outTokens.push({
        symbol: data.symbol,
        amount: data.totalOut,
        usdValue: data.totalOut * data.price,
        marketCapUsd: data.marketCapUsd
      });
    }
    // inTokens
    if (data.totalIn > 0) {
      tokenDetails.inTokens.push({
        symbol: data.symbol,
        amount: data.totalIn,
        usdValue: data.totalIn * data.price,
        marketCapUsd: data.marketCapUsd
      });
    }
  }

  // Identify finalToken (the last incoming op)
  const lastIncomingOp = [...operations].reverse().find(
    (op: any) => (op.to || "").toLowerCase() === userAddr
  );
  if (lastIncomingOp) {
    const finalAddr = (lastIncomingOp.tokenInfo?.address || "").toLowerCase();
    if (tokenOperations.has(finalAddr)) {
      const finalData = tokenOperations.get(finalAddr)!;
      const finalAmt = parseFloat(lastIncomingOp.value) / (10 ** finalData.decimals);
      tokenDetails.finalToken = {
        symbol: finalData.symbol,
        amount: finalAmt,
        usdValue: finalAmt * finalData.price,
        marketCapUsd: finalData.marketCapUsd
      };
    }
  }

  // Basic classification
  let fromIsZero = false;
  if (operations[0]) {
    fromIsZero =
      !operations[0].from ||
      operations[0].from === "0x0000000000000000000000000000000000000000";
  }

  if (fromIsZero && (operations[0]?.to || "").toLowerCase() === userAddr) {
    type = "mint";
  } else {
    const hasOut = tokenDetails.outTokens.length > 0;
    const hasIn = tokenDetails.inTokens.length > 0;

    if (hasOut && hasIn) {
      type = "swap";
    } else if (hasOut) {
      type = "send";
    } else if (hasIn) {
      type = "receive";
    }
  }

  // If user spent ETH but it ended "send"/"receive" & they got some other token => swap
  if (
    userIsSender &&
    spentEthAmount > 0 &&
    (type === "receive" || type === "send") &&
    tokenDetails.inTokens.some((t) => t.symbol !== "ETH")
  ) {
    type = "swap";
  }

  const outSymbols = tokenDetails.outTokens.map((t) => t.symbol);
  const inSymbols = tokenDetails.inTokens.map((t) => t.symbol);

  // Summation for totalUsdValue
  const sumOut = tokenDetails.outTokens.reduce((acc, t) => acc + t.usdValue, 0);
  const sumIn = tokenDetails.inTokens.reduce((acc, t) => acc + t.usdValue, 0);
  const totalUsdValue = Math.max(sumOut, sumIn);

  // ---------------------------------------------------
  // NEW: Pick a single token’s usdValue & marketCap
  // Priority: finalToken if it exists, else the first outToken if any,
  // else the first inToken if any. Adjust as you see fit.
  // ---------------------------------------------------
  let chosenTokenUsdValue = 0;
  let chosenTokenMarketCap = 0;

  if (tokenDetails.finalToken) {
    // If finalToken is present, choose it
    chosenTokenUsdValue = tokenDetails.finalToken.usdValue;
    chosenTokenMarketCap = tokenDetails.finalToken.marketCapUsd;
  } else if (tokenDetails.outTokens.length > 0) {
    chosenTokenUsdValue = tokenDetails.outTokens[0].usdValue;
    chosenTokenMarketCap = tokenDetails.outTokens[0].marketCapUsd;
  } else if (tokenDetails.inTokens.length > 0) {
    chosenTokenUsdValue = tokenDetails.inTokens[0].usdValue;
    chosenTokenMarketCap = tokenDetails.inTokens[0].marketCapUsd;
  }
  // ---------------------------------------------------

  return {
    type,
    tokenDetails,
    outSymbols,
    inSymbols,
    totalUsdValue,
    chosenTokenUsdValue,
    chosenTokenMarketCap
  };
}

// --------------- Build summary string ---------------
export function buildSummary(
  type: string,
  tokenDetails: {
    outTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    inTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    finalToken: null | { symbol: string; amount: number; usdValue: number; marketCapUsd: number };
  }
): string {
  let summary = "";

  const outStr = tokenDetails.outTokens
    .map((t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`)
    .join(" + ");
  const inStr = tokenDetails.inTokens
    .map((t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`)
    .join(" + ");

  if (type === "mint") {
    summary = `Minted ${inStr}`;
  } else if (type === "swap") {
    summary = `Swapped ${outStr} for ${inStr}`;
  } else if (type === "send") {
    summary = `Sent ${outStr}`;
  } else if (type === "receive") {
    summary = `Received ${inStr}`;
  }

  return summary;
}

// --------------- Store transaction if not present ---------------
export async function storeTransactionIfNeeded(
  tx: any,
  tokenDetails: {
    outTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    inTokens: { symbol: string; amount: number; usdValue: number; marketCapUsd: number }[];
    finalToken: null | { symbol: string; amount: number; usdValue: number; marketCapUsd: number };
  },
  type: string,
  summary: string,
  totalUsdValue: number,
  outSymbols: string[],
  inSymbols: string[],
  chosenTokenUsdValue: number,     // <--
  chosenTokenMarketCap: number     // <--
): Promise<void> {
  const existing = await EtherTransaction.findOne({ hash: tx.hash });
  if (existing) {
    return;
  }

  // Build symbols
  const tokenSymbol = (outSymbols.length > 0)
    ? outSymbols.join(", ")
    : (inSymbols.length > 0 ? inSymbols.join(", ") : "UNKNOWN");

  let tokenSymbol2 = "UNKNOWN";
  if (tokenDetails.finalToken?.symbol) {
    tokenSymbol2 = tokenDetails.finalToken.symbol;
  } else if (inSymbols.length) {
    tokenSymbol2 = inSymbols.join(", ");
  }

  try {
    await EtherTransaction.create({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      timeStamp: tx.timeStamp,
      nonce: tx.nonce,
      transactionIndex: tx.transactionIndex,
      from: tx.from,
      to: tx.to,
      value: Number(tx.value),
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      isError: tx.isError,
      input: tx.input,
      contractAddress: tx.contractAddress,
      cumulativeGasUsed: tx.cumulativeGasUsed,
      gasUsed: tx.gasUsed,
      confirmations: tx.confirmations,

      // Original fields
      tokenName: tx.tokenName || "",
      tokenSymbol,
      tokenSymbol2,
      tokenDecimal: Number(tx.tokenDecimal) || 18,

      // Enhanced tracking
      type,
      summary,
      outTokens: tokenDetails.outTokens,
      inTokens: tokenDetails.inTokens,
      finalToken: tokenDetails.finalToken,
      totalUsdValue,
      usdPrice: totalUsdValue,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000),
      singleTransaction:
        tokenDetails.outTokens.length <= 1 && tokenDetails.inTokens.length <= 1,

      // NEW: Single token’s USD + marketCap
      singleTokenUsdValue: chosenTokenUsdValue,
      singleTokenMarketCap: chosenTokenMarketCap
    });
  } catch (error) {
    console.error("Error creating EtherTransaction record:", error);
    Logger.error(`DB insert error for tx ${tx.hash}: ${String(error)}`);
  }
}
