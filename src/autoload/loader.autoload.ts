// src/autoload/loader.autoload.ts

import dotenv from "dotenv"
import Logger from "../logger"
import http from "http"
import DB_Connect from "../database/connect.database";
import Socket from "socket.io"
import fs from "fs"
import { config } from "../../config";
import path from 'path';
import express from "express";
import bearerToken from "express-bearer-token";
import { set } from "mongoose";
import EthereumWallet from "../database/models/EtherWallet";
import EtherTransaction from "../database/models/EtherTransaction";
import SolanaWallet from "../database/models/SolWallet";
import SolTransaction from "../database/models/SolTransaction";
import axios from "axios";
import BnbTransaction from "../database/models/BnbTransaction";
import BnbWallet from "../database/models/BnbWallet";

dotenv.config()

interface TokenDetail {
    symbol: string;
    amount: number;
    usdValue: number;
}

interface TokenOperationData {
    symbol: string;
    decimals: number;
    price: number;
    totalOut: number;
    totalIn: number;
    operations: any[];
}

interface TransactionTokenDetails {
    outTokens: TokenDetail[];
    inTokens: TokenDetail[];
    finalToken: TokenDetail | null;
}

export class Autoload { // This is the class that starts the server
    static app: express.Express | null = Boolean(process.env.HTTP_API) == true ? express() : null;
    static socket: Socket.Server | null = Boolean(process.env.WEBSOCKETS_API) == true ? new Socket.Server(process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 3001) : null;
    static port: number = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 3000;
    static baseDir = path.resolve(__dirname, "../socket");
    static ETH_APIKEY = process.env.ETH_APIKEY;
    static ETHPLORER_APIKEY = process.env.ETHPLORER_APIKEY;
    static arrayStables = ["USDT", "USDC", "DAI", "BUSD", "PAX", "ETH", "WETH", "WBTC"]
    
    static rateLimitThreshold = 10000; // 10 000 Events par seconde
    static rateLimitDuration = 10000; // 1 seconde
    static clients = new Map();

    static BSC_APIKEY = process.env.BSC_APIKEY;
    static arrayStablesBNB = ["BUSD", "USDT", "USDC", "DAI", "CAKE", "BNB", "WBNB"];

    constructor() {
        Autoload.port = Number(process.env.HTTP_PORT) || 3000
        //Autoload.app.use(Autoload.rateLimiter)
        Autoload.start()
        Logger.success("Server started on port " + Autoload.port)
    }

    public static logInfo = () => {
        // ${config.application.description}
        Logger.normal(`
        ${config.ascii.art}

        Version: ${config.api.version}
        Port: ${Number(process.env.HTTP_PORT) || 3000}
        `)
        // Owners: ${config.application.owners.join(", ")}
    }


    // Rate limiter methods
    static isRateLimited(socketId: string): boolean {
        const record = Autoload.clients.get(socketId);
        if (!record) return false;

        return record.requests > Autoload.rateLimitThreshold;
    }

    static rateLimiterMiddleware(socket: Socket.Socket, handler: any) {
        const socketId = socket.id;
    
        if (!Autoload.clients.has(socketId)) {
            Autoload.clients.set(socketId, { requests: 0, timer: null });
        }
    
        const record = Autoload.clients.get(socketId);
        record.requests += 1;
    
        if (record.requests > Autoload.rateLimitThreshold && !record.timer) {
            // Set the timer only once when the threshold is exceeded
            record.timer = setTimeout(() => {
                record.requests = 0;  // reset the request count
                clearTimeout(record.timer);  // clear the timer
                record.timer = null;  // reset the timer
            }, Autoload.rateLimitDuration);
        }
    
        if (record.requests > Autoload.rateLimitThreshold) {
            Logger.warn(`Requests from socket ${socketId} are currently blocked due to rate limit.`);
            return;  // Just return without processing the request
        }
    
        handler();
    }
    
    
    protected static autoloadRoutesFromDirectory(directory: string): void {
        if(!Autoload.app) return
        const httpMethods: (keyof express.Application)[] = ["get", "post", "put", "delete", "patch", "head", "options"];
        const files = fs.readdirSync(directory);
    
        for (const file of files) {
            const fullPath = path.join(directory, file);
    
            if (fs.statSync(fullPath).isDirectory()) {
                Autoload.autoloadRoutesFromDirectory(fullPath);
            } else if (file.endsWith('.ts') || file.endsWith('.js')) {
                const route = require(fullPath).default;
                if (route && typeof route.run === 'function' && route.method && route.name) {
                    const httpMethod = route.method.toLowerCase() as keyof express.Application;
                    if (httpMethods.includes(httpMethod)) {
                        Autoload.app[httpMethod](`/api${route.name}`, route.run);
                        Logger.info(`Loaded route ${route.method} /api${route.name}`);
                    } else {
                        Logger.warn(`Unknown HTTP method: ${route.method}`);
                    }
                }
            }
        }
    }


    protected static autoloadFilesFromDirectory(directory: string): any[] { // This is the function that is recursively loading all sockets files from the directory socket
        const handlers: any[] = [];
        const files = fs.readdirSync(directory);
    
        for (const file of files) {
            const fullPath = path.join(directory, file);
    
            if (fs.statSync(fullPath).isDirectory()) {
                handlers.push(...Autoload.autoloadFilesFromDirectory(fullPath));
            } else if (file.endsWith('.ts')) {
                const handler = require(fullPath).default;
                handlers.push(handler);
            }
        }
    
        return handlers;
    }
    
    protected static attachHandlersToSocket(socket: Socket.Socket) { 

    }

    private static async fetchAndUpdateSolanaTransactions() {
        try {
            const solanaWallets = await SolanaWallet.find();
    
            for (const wallet of solanaWallets) {
                for (const address of wallet.wallets) {
                    await new Promise(resolve => setTimeout(resolve, 1000 / 5)); 
    
                    const params = JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "getConfirmedSignaturesForAddress2",
                        params: [
                            address,
                            { limit: 20 }
                        ]
                    });
    
                    const rpcUrl = 'https://api.mainnet-beta.solana.com';
    
                    try {
                        const signaturesResponse = await axios.post(rpcUrl, params, {
                            headers: {'Content-Type': 'application/json'}
                        });
    
                        let signatures = signaturesResponse.data.result;
    
                        for (const sigInfo of signatures) {
                            const txParams = JSON.stringify({
                                jsonrpc: "2.0",
                                id: 1,
                                method: "getTransaction",
                                params: [
                                    sigInfo.signature,
                                    "jsonParsed"
                                ]
                            });
    
                            const txResponse = await axios.post(rpcUrl, txParams, {
                                headers: {'Content-Type': 'application/json'}
                            });
    
                            const transactionDetails = txResponse.data.result;
                            if (!transactionDetails) continue;
    
                            const { transaction, meta } = transactionDetails;
                            const postTokenBalances = meta.postTokenBalances;
                            const preTokenBalances = meta.preTokenBalances;
    
                            const swaps = [];
    
                            if (postTokenBalances && preTokenBalances) {
                                for (const postBalance of postTokenBalances) {
                                    const preBalance = preTokenBalances.find((pre: { mint: any; }) => pre.mint === postBalance.mint);
                                    if (preBalance) {
                                        const amountChange = postBalance.uiTokenAmount.uiAmount - preBalance.uiTokenAmount.uiAmount;
                                        const tokenSymbol = postBalance.uiTokenAmount.tokenSymbol || 'EXCHANGE';
    
                                        swaps.push({
                                            tokenSymbol: tokenSymbol,
                                            amountChange: amountChange
                                        });
                                    }
                                }
                            }
    
                            swaps.forEach(swap => {
                                console.log(`${swap.tokenSymbol}: ${swap.amountChange > 0 ? '+' : ''}${swap.amountChange}`);
                            });
    
                            await new SolTransaction({
                                signature: sigInfo.signature,
                                blockTime: transactionDetails.blockTime,
                                slot: transactionDetails.slot,
                                swaps: swaps
                            }).save();
                        }
    
                    } catch (error) {
                        Logger.error(`Error fetching Solana transactions for wallet ${address}: ${error}`);
                    }
                }
            }
        } catch (error) {
            Logger.error(`Failed to fetch Solana transactions: ${error}`);
        }
        setTimeout(Autoload.fetchAndUpdateSolanaTransactions, 5000); // Schedule the next update
    }

    private static async fetchAndUpdateBnbTransactions() {
        try {
            const wallets = await BnbWallet.find();
            const currentTime = new Date();
            const yesterday = new Date(currentTime.setDate(currentTime.getDate() - 7)).setHours(0, 0, 0, 0) / 1000;
    
            for (const wallet of wallets) {
                for (const address of wallet.wallets) {
                    await new Promise(resolve => setTimeout(resolve, 1000 / 5));
                    const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.BSC_APIKEY}`;
    
                    try {
                        const response = await axios.get(url);
                        let transactions = response.data.result;

                        transactions = transactions
                            .sort((a: any, b: any) => parseInt(b.timeStamp) - parseInt(a.timeStamp))
                            .filter((tx: any) => parseInt(tx.timeStamp) >= yesterday)
                            .filter((tx: any) => wallet.lastTransaction < new Date(parseInt(tx.timeStamp) * 1000));
    
                        for (const tx of transactions) {
                            const tokenValue = Number(tx.value) / (10 ** tx.tokenDecimal);
                            
                            // Get price from PancakeSwap API for BNB Chain tokens
                            const priceResponse = await axios.get(`https://api.pancakeswap.info/api/v2/tokens/${tx.contractAddress}`);
                            const tokenPriceInUsd = priceResponse.data.data.price || 0;
                            const tokenValueInUsd = tokenValue * tokenPriceInUsd;
    
                            if (!await BnbTransaction.findOne({ hash: tx.hash }) && tokenValueInUsd >= 10000) {
                                await new BnbTransaction({
                                    ...tx,
                                    value: tokenValueInUsd,
                                    usdPrice: tokenValueInUsd,
                                    type: Autoload.arrayStables.includes(tx.tokenSymbol) ? "sell" : "buy"
                                }).save();
                            }
    
                            wallet.lastTransaction = new Date();
                            await wallet.save();
                        }
                    } catch (error) {
                        Logger.error(`Error fetching BNB transactions for wallet ${address}: ${error}`);
                    }
                }
            }
        } catch (error) {
            Logger.error(`Failed to fetch BNB transactions: ${error}`);
        }
        setTimeout(Autoload.fetchAndUpdateBnbTransactions, 5000);
    }
    
    private static async getTokenPriceFromPancakeSwap(tokenAddress: string): Promise<number> {
        try {
            const response = await axios.get(`https://api.pancakeswap.info/api/v2/tokens/${tokenAddress}`);
            return response.data.data.price || 0;
        } catch (error) {
            Logger.error(`Failed to fetch token price from PancakeSwap: ${error}`);
            return 0;
        }
    }   
    
    public static async fetchAndUpdateTransactions() {
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      
        const processTransactions = async () => {
          try {
            const wallets = await EthereumWallet.find();
            const currentTime = new Date();
            // Last 3 days:
            const threeDaysAgo = Math.floor(
                (currentTime.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000
            );

            const weekAgo = Math.floor(
                (currentTime.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000
            );

      
            for (const wallet of wallets) {
              for (const address of wallet.wallets) {
                console.log(`\n[FETCH] Transactions for ${wallet.username} - ${address}`);
                await delay(200);
      
                // 1) Fetch from Etherscan's tokenTx endpoint (ERC-20 history)
                const url =
                  `https://api.etherscan.io/api` +
                  `?module=account&action=tokentx&address=${address}` +
                  `&startblock=0&endblock=99999999&sort=desc` +
                  `&apikey=${Autoload.ETH_APIKEY}`;
      
                let response;
                try {
                  response = await axios.get(url);
                } catch (err) {
                  console.error(`Error fetching Etherscan tokenTx for ${address}`, err);
                  continue;
                }
      
                if (!response?.data?.result) {
                  console.log(`No tokenTx results found for ${address}`);
                  continue;
                }
      
                let transactions: any[] = response.data.result;
                // Filter last 3 days
                transactions = transactions
                  .filter((tx) => parseInt(tx.timeStamp) >= threeDaysAgo)
                  .sort((a, b) => parseInt(b.timeStamp) - parseInt(a.timeStamp));
      
                console.log(`=> After filtering 3 days, count: ${transactions.length}`);
      
                const processedTxs = new Set<string>();
                let index = 0;
      
                for (const tx of transactions) {
                  index++;
                  try {
                    // Avoid duplicates
                    if (processedTxs.has(tx.hash)) continue;
                    processedTxs.add(tx.hash);
      
                    console.log(`[${index}/${transactions.length}] Checking tx: ${tx.hash}`);
                    await delay(300); // Rate limit
      
                    // 2) Fetch advanced info from Ethplorer
                    const ethplorerUrl = `https://api.ethplorer.io/getTxInfo/${tx.hash}?apiKey=${Autoload.ETHPLORER_APIKEY}`;
                    let ethplorerResponse;
                    try {
                      ethplorerResponse = await axios.get(ethplorerUrl);
                    } catch (err) {
                      console.error(`Failed Ethplorer for tx ${tx.hash}`, err);
                      continue;
                    }
      
                    if (!ethplorerResponse?.data) {
                      console.log(`No Ethplorer data for tx ${tx.hash}, skipping...`);
                      continue;
                    }
      
                    const txData = ethplorerResponse.data;
                    // CRITICAL: read the "real" from/to/value from the top-level, not from tokenTx
                    const realFrom = txData.from?.toLowerCase() || "";
                    const realTo = txData.to?.toLowerCase() || "";
                    const realValueWei = parseFloat(txData.value || "0"); // raw wei
      
                    // We'll parse the operations array
                    const operations = txData.operations || [];
                    console.log(
                      `TX ${tx.hash}: top-level from=${realFrom}, to=${realTo}, valueWei=${realValueWei}, ops=${operations.length}`
                    );
      
                    const userAddr = address.toLowerCase();
                    const userIsSender = (realFrom === userAddr);
      
                    // ----------------------------------------------------------
                    // Step A) Build aggregated tokenOperations from Ethplorer logs
                    // ----------------------------------------------------------
                    // We'll store everything in tokenOperations so we can track totalIn / totalOut
                    const tokenOperations = new Map<string, TokenOperationData>();
      
                    // If user was top-level sender and spent ETH
                    let spentEthAmount = 0;
                    if (userIsSender && realValueWei > 0) {
                      spentEthAmount = realValueWei / 1e18; // convert to ETH
                      // We'll store a synthetic "ETH out"
                      const fallbackEthPrice = 1700; // Adjust as needed
                      tokenOperations.set("0xETH_NATIVE", {
                        symbol: "ETH",
                        decimals: 18,
                        price: fallbackEthPrice,
                        totalOut: spentEthAmount,
                        totalIn: 0,
                        operations: []
                      });
                    }
      
                    // Parse all ERC20 operations
                    for (const op of operations) {
                      const tokenAddr = op.tokenInfo?.address?.toLowerCase();
                      if (!tokenAddr) continue;
      
                      // Initialize map entry if needed
                      if (!tokenOperations.has(tokenAddr)) {
                        tokenOperations.set(tokenAddr, {
                          symbol: op.tokenInfo?.symbol || "UNKNOWN",
                          decimals: op.tokenInfo?.decimals
                            ? Number(op.tokenInfo.decimals)
                            : 18,
                          price: op.tokenInfo?.price?.rate || 0,
                          totalOut: 0,
                          totalIn: 0,
                          operations: []
                        });
                      }
      
                      const tOp = tokenOperations.get(tokenAddr)!;
                      tOp.operations.push(op);
      
                      // Convert the token value
                      const numericValue =
                        parseFloat(op.value) / (10 ** tOp.decimals);
      
                      // If op.from is user, it's outgoing
                      if (op.from?.toLowerCase() === userAddr) {
                        tOp.totalOut += numericValue;
                      }
                      // If op.to is user, it's incoming
                      if (op.to?.toLowerCase() === userAddr) {
                        tOp.totalIn += numericValue;
                      }
                    }
      
                    // ----------------------------------------------------------
                    // Step B) Fetch Internal Transactions from Etherscan
                    //     to detect if user received native ETH internally
                    // ----------------------------------------------------------
                    const internalTxUrl = `https://api.etherscan.io/api`
                      + `?module=account&action=txlistinternal`
                      + `&txhash=${tx.hash}`
                      + `&apikey=${Autoload.ETH_APIKEY}`;
                    let internalTxResp;
                    try {
                      internalTxResp = await axios.get(internalTxUrl);
                    } catch (err) {
                      console.error(`Failed internalTx for ${tx.hash}`, err);
                    }
      
                    const internalTransfers = internalTxResp?.data?.result || [];
                    // If user got native ETH internally, let's add it as "ETH" in
                    for (const itx of internalTransfers) {
                      const toAddr = itx.to?.toLowerCase();
                      // We only care if user is the recipient
                      if (toAddr === userAddr && parseInt(itx.value) > 0) {
                        const fallbackEthPrice = 1700; // or dynamic
                        const nativeKey = "0xETH_NATIVE";
                        if (!tokenOperations.has(nativeKey)) {
                          tokenOperations.set(nativeKey, {
                            symbol: "ETH",
                            decimals: 18,
                            price: fallbackEthPrice,
                            totalOut: 0,
                            totalIn: 0,
                            operations: []
                          });
                        }
                        const nativeEthOp = tokenOperations.get(nativeKey)!;
                        const valWei = parseFloat(itx.value);
                        const valEth = valWei / 1e18;
                        nativeEthOp.totalIn += valEth;
                        // Optionally store an internalTx op
                        nativeEthOp.operations.push({
                          type: "internalTx",
                          from: itx.from?.toLowerCase() || "",
                          to: toAddr,
                          value: itx.value
                        });
                      }
                    }
      
                    // ----------------------------------------------------------
                    // Step C) Classify (swap, send, receive, mint, etc.)
                    // ----------------------------------------------------------
                    const tokenDetails: TransactionTokenDetails = {
                      outTokens: [],
                      inTokens: [],
                      finalToken: null
                    };
      
                    // Summarize outTokens / inTokens
                    for (const [addr, data] of tokenOperations) {
                      if (data.totalOut > 0) {
                        tokenDetails.outTokens.push({
                          symbol: data.symbol,
                          amount: data.totalOut,
                          usdValue: data.totalOut * data.price
                        });
                      }
                      if (data.totalIn > 0) {
                        tokenDetails.inTokens.push({
                          symbol: data.symbol,
                          amount: data.totalIn,
                          usdValue: data.totalIn * data.price
                        });
                      }
                    }
      
                    // Identify final token by looking at the last ERC-20 op that credited the user
                    const lastIncomingOp = [...operations].reverse().find(
                      (op: any) => op.to?.toLowerCase() === userAddr
                    );
                    if (lastIncomingOp) {
                      const finalAddr = lastIncomingOp.tokenInfo?.address?.toLowerCase();
                      if (finalAddr && tokenOperations.has(finalAddr)) {
                        const finalData = tokenOperations.get(finalAddr)!;
                        const finalAmt = parseFloat(lastIncomingOp.value) /
                                         (10 ** finalData.decimals);
                        tokenDetails.finalToken = {
                          symbol: finalData.symbol,
                          amount: finalAmt,
                          usdValue: finalAmt * finalData.price
                        };
                      }
                    } else {
                      // Possibly check if user minted or unwrapped WETH -> ETH
                      // (But we've already handled internalTx -> ETH above)
                    }
      
                    // Basic type classification
                    let type = "unknown";
      
                    // Mint detection:
                    const fromIsZero = operations[0] &&
                      (!operations[0].from ||
                        operations[0].from === "0x0000000000000000000000000000000000000000");
                    if (fromIsZero && operations[0]?.to?.toLowerCase() === userAddr) {
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
      
                    // SWAP OVERRIDE if user was top-level sender with ETH
                    // but we ended up with "receive" or "send" incorrectly
                    if (
                      userIsSender &&
                      spentEthAmount > 0 &&
                      type === "receive" &&
                      tokenDetails.inTokens.some((t) => t.symbol !== "ETH")
                    ) {
                      console.log("[SWAP OVERRIDE] user spent native ETH, got a different token");
                      type = "swap";
                    }
      
                    // Check if multi-swap (multiple tokens in/out)
                    const distinctOutTokens = tokenDetails.outTokens.filter(t => t.amount > 0);
                    const distinctInTokens = tokenDetails.inTokens.filter(t => t.amount > 0);
                    const isMultiSwap =
                      distinctOutTokens.length > 1 || distinctInTokens.length > 1;
                    if (isMultiSwap && type === "swap") {
                      type = "multi-swap";
                    }
      
                    // Step D) Calculate totalUsdValue
                    const sumOut = tokenDetails.outTokens.reduce((acc, t) => acc + t.usdValue, 0);
                    const sumIn = tokenDetails.inTokens.reduce((acc, t) => acc + t.usdValue, 0);
                    const totalUsdValue = Math.max(sumOut, sumIn);

                    if(totalUsdValue < 5000) continue
      
                    // Step E) Build summary
                    let summary = "";
                    if (type === "mint") {
                      const minted = tokenDetails.inTokens
                        .map(
                          (t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`
                        )
                        .join(" + ");
                      summary = `Minted ${minted}`;
                    } else if (type === "swap" || type === "multi-swap") {
                      const outStr = tokenDetails.outTokens
                        .map(
                          (t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`
                        )
                        .join(" + ");
                      const inStr = tokenDetails.inTokens
                        .map(
                          (t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`
                        )
                        .join(" + ");
                      summary = `Swapped ${outStr} for ${inStr}`;
                      if (type === "multi-swap") {
                        summary = `[MULTI] ${summary}`;
                      }
                    } else if (type === "send") {
                      const outStr = tokenDetails.outTokens
                        .map(
                          (t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`
                        )
                        .join(" + ");
                      summary = `Sent ${outStr}`;
                    } else if (type === "receive") {
                      const inStr = tokenDetails.inTokens
                        .map(
                          (t) => `${t.amount.toFixed(4)} ${t.symbol} ($${t.usdValue.toFixed(2)})`
                        )
                        .join(" + ");
                      summary = `Received ${inStr}`;
                    }
      
                    console.log("[ANALYSIS]", {
                      hash: tx.hash,
                      realFrom,
                      realTo,
                      userIsSender,
                      spentEthAmount,
                      type,
                      summary,
                      outTokens: tokenDetails.outTokens,
                      inTokens: tokenDetails.inTokens,
                      finalToken: tokenDetails.finalToken,
                    });
      
                    // Step F) Save to DB if not present
                    const existing = await EtherTransaction.findOne({ hash: tx.hash });
                    if (!existing) {
                      // Build the final symbols for saving:
                      const allOutSymbols = tokenDetails.outTokens.map(t => t.symbol);
                      const allInSymbols = tokenDetails.inTokens.map(t => t.symbol);
      
                      await EtherTransaction.create({
                        hash: tx.hash,
                        blockNumber: tx.blockNumber,
                        timeStamp: tx.timeStamp,
                        nonce: tx.nonce,
                        transactionIndex: tx.transactionIndex,
                        from: tx.from,
                        to: tx.to,
                        value: Number(tx.value), // raw in Wei from Etherscan tokenTx
                        gas: tx.gas,
                        gasPrice: tx.gasPrice,
                        isError: tx.isError,
                        input: tx.input || "deprecated",
                        contractAddress: tx.contractAddress,
                        cumulativeGasUsed: tx.cumulativeGasUsed,
                        gasUsed: tx.gasUsed,
                        confirmations: tx.confirmations,
      
                        // Original fields
                        tokenName: tx.tokenName,
                        // If only 1 distinct out token, store it, else "MULTIPLE" or "UNKNOWN"
                        tokenSymbol:
                          allOutSymbols.length === 1
                            ? allOutSymbols[0]
                            : (allOutSymbols.length > 1 ? "MULTIPLE" : "UNKNOWN"),
                        // For "second" token, try finalToken or fallback to single inSymbol
                        tokenSymbol2:
                          tokenDetails.finalToken?.symbol ||
                          (
                            allInSymbols.length === 1
                              ? allInSymbols[0]
                              : (allInSymbols.length > 1 ? "MULTIPLE" : "UNKNOWN")
                          ),
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
      
                        // Track multi-swap if you want
                        isMultiSwap
                      });
                    }
      
                    // Update the wallet
                    wallet.lastTransaction = new Date();
                    await wallet.save();
                  } catch (err) {
                    console.error(`Error processing transaction ${tx.hash}:`, err);
                    Logger.error(`Error processing tx ${tx.hash}: ${String(err)}`);
                  }
                }
              }
            }
          } catch (error) {
            console.error("Main process error:", error);
            Logger.error(`Fetch Error: ${String(error)}`);
          }
        };
      
        // Initial call
        await processTransactions();
      
        // Schedule next run (example every 30 sec)
        setTimeout(() => {
          Autoload.fetchAndUpdateTransactions();
        }, 30000);
      }
      

    

    protected static async getTokenPriceAndSymbol(hash: string, tokenSymbol: string, walletAddress: string) {
        // delay to keep under 10 req/s
        await new Promise(resolve => setTimeout(resolve, 1000 / 10));
        try {
            const response = await axios.get(`https://api.ethplorer.io/getTxInfo/${hash}?apiKey=${Autoload.ETHPLORER_APIKEY}`);

            let tokenInfo = {} as any;
            let tokenPrice = 0;
            let tokenSymbol2 = 'exchange';
            // for loop to get token different tokenSymbol than the one we are looking for (and if the from or to address field has the wallet address). If its the same, take the price
            for (let i = 0; i < response.data.operations.length; i++) {
                tokenInfo = response.data.operations[i].tokenInfo;
                if (tokenInfo.symbol !== tokenSymbol && tokenInfo.symbol.toLowerCase() !== tokenSymbol.toLowerCase()) {
                    if ((response.data.operations[i].from === walletAddress || response.data.operations[i].to === walletAddress)) {
                        tokenSymbol2 = tokenInfo.symbol;
                    }
                } else {
                    tokenPrice = tokenInfo.price.rate || 0;
                }
            }

            // Extract the price and symbol
            const price = tokenPrice
            const symbol = tokenSymbol2

            // Return the price and symbol
            return { price, symbol };
        }
        catch (error) {
            Logger.error(`Failed to fetch token price from Ethplorer: ${error}`);
            return { price: 0, symbol: '' };
        }
    }
    

    protected static rules() { // This is the function that sets the API rules
        if(!Autoload.app) return
        Autoload.app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header('Content-Type', 'application/json')
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            if (req.method === 'OPTIONS') {
                res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH');
                return res.status(200).json({})
            }
            next()
        })
    }

    public static start() {
        Logger.beautifulSpace()
        Logger.info("Starting server...")
        DB_Connect().then(() => {
            Autoload.fetchAndUpdateTransactions(); // Ethereum
            // Autoload.fetchAndUpdateSolanaTransactions(); // Solana
            // Autoload.fetchAndUpdateBnbTransactions(); // BNB Chain
            Autoload.rules()
            if(Autoload.app) {
                Autoload.app.use(bearerToken())
                Autoload.app.use(express.json())
                Autoload.autoloadRoutesFromDirectory(path.join(__dirname, '../http'));
    
                Autoload.app.listen(Autoload.port, () => {
                    Logger.success(`Server started on port ${Autoload.port}`)
                });
            }
    
            Logger.beautifulSpace()
            Autoload.logInfo()
            Logger.beautifulSpace()
        })
    }
    


    public static stop() { // This is the function that stops the server
        if(Autoload.socket) Autoload.socket.close()
        if(Autoload.app) Autoload.app.removeAllListeners()
    }
}
