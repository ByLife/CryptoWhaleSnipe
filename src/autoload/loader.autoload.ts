// src/autoload/loader.autoload.ts

import dotenv from "dotenv";
import Logger from "../logger";
import http from "http";
import DB_Connect from "../database/connect.database";
import Socket from "socket.io";
import fs from "fs";
import { config } from "../../config";
import path from "path";
import express from "express";
import bearerToken from "express-bearer-token";
import { set } from "mongoose";
import EthereumWallet from "../database/models/EtherWallet";
import EtherTransaction from "../database/models/EtherTransaction";
import SolanaWallet from "../database/models/SolWallet";
import SolTransaction from "../database/models/SolTransaction";
import axios from "axios";
import {
  buildSummary,
  classifyTransaction,
  delay,
  fetchEtherscanTxs,
  fetchEthplorerData,
  parseTokenOperations,
  storeTransactionIfNeeded,
} from "./utils/EthTransactionHelpers";
import { processSolSwaps } from "./utils/SolanaTransactionHelpers";
import SignalTransactions, {
  SignalTransaction,
} from "../database/models/SignalTransactions";

dotenv.config();

interface TokenData {
  totalUsdValue: number;
  buys: number;
  sells: number;
  walletNames: Set<string>;
  chain: "ETH" | "SOL";
}

interface TokenDetail {
  symbol: string;
  amount: number;
  usdValue: number;
}

interface TransactionTokenDetails {
  outTokens: TokenDetail[];
  inTokens: TokenDetail[];
  finalToken: TokenDetail | null;
}

export class Autoload {
  // This is the class that starts the server
  static app: express.Express | null =
    Boolean(process.env.HTTP_API) == true ? express() : null;
  static socket: Socket.Server | null =
    Boolean(process.env.WEBSOCKETS_API) == true
      ? new Socket.Server(
          process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 3001
        )
      : null;
  static port: number = process.env.HTTP_PORT
    ? Number(process.env.HTTP_PORT)
    : 3000;
  static baseDir = path.resolve(__dirname, "../socket");

  static ETH_APIKEY = process.env.ETH_APIKEY;
  static ETHPLORER_APIKEY = process.env.ETHPLORER_APIKEY;

  public static HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  public static SOLANA_API_URL = "https://api.mainnet-beta.solana.com";

  static arrayStables = [
    "USDT",
    "USDC",
    "DAI",
    "BUSD",
    "PAX",
    "ETH",
    "WETH",
    "WBTC",
    "USDe",
    "USDE",
  ];

  static rateLimitThreshold = 10000; // 10 000 Events par seconde
  static rateLimitDuration = 10000; // 1 seconde
  static clients = new Map();

  static BSC_APIKEY = process.env.BSC_APIKEY;
  static arrayStablesBNB = [
    "BUSD",
    "USDT",
    "USDC",
    "DAI",
    "CAKE",
    "BNB",
    "WBNB",
  ];

  constructor() {
    Autoload.port = Number(process.env.HTTP_PORT) || 3000;
    //Autoload.app.use(Autoload.rateLimiter)
    Autoload.start();
    Logger.success("Server started on port " + Autoload.port);
  }

  public static logInfo = () => {
    // ${config.application.description}
    Logger.normal(`
        ${config.ascii.art}

        Version: ${config.api.version}
        Port: ${Number(process.env.HTTP_PORT) || 3000}
        `);
    // Owners: ${config.application.owners.join(", ")}
  };

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
        record.requests = 0; // reset the request count
        clearTimeout(record.timer); // clear the timer
        record.timer = null; // reset the timer
      }, Autoload.rateLimitDuration);
    }

    if (record.requests > Autoload.rateLimitThreshold) {
      Logger.warn(
        `Requests from socket ${socketId} are currently blocked due to rate limit.`
      );
      return; // Just return without processing the request
    }

    handler();
  }

  protected static autoloadRoutesFromDirectory(directory: string): void {
    if (!Autoload.app) return;
    const httpMethods: (keyof express.Application)[] = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "head",
      "options",
    ];
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const fullPath = path.join(directory, file);

      if (fs.statSync(fullPath).isDirectory()) {
        Autoload.autoloadRoutesFromDirectory(fullPath);
      } else if (file.endsWith(".ts") || file.endsWith(".js")) {
        const route = require(fullPath).default;
        if (
          route &&
          typeof route.run === "function" &&
          route.method &&
          route.name
        ) {
          const httpMethod =
            route.method.toLowerCase() as keyof express.Application;
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

  protected static autoloadFilesFromDirectory(directory: string): any[] {
    // This is the function that is recursively loading all sockets files from the directory socket
    const handlers: any[] = [];
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const fullPath = path.join(directory, file);

      if (fs.statSync(fullPath).isDirectory()) {
        handlers.push(...Autoload.autoloadFilesFromDirectory(fullPath));
      } else if (file.endsWith(".ts")) {
        const handler = require(fullPath).default;
        handlers.push(handler);
      }
    }

    return handlers;
  }

  protected static attachHandlersToSocket(socket: Socket.Socket) {}

  public static async aggregateTransactions() {
    try {
      // Get wallets
      const walletsEth = await EthereumWallet.find().lean();
      const walletsSol = await SolanaWallet.find().lean();

      const ethAddresses = new Set(
        walletsEth.map((w) => w.wallets[0].toLowerCase())
      );
      const solAddresses = new Set(
        walletsSol.map((w) => w.wallets[0].toLowerCase())
      );

      // Get transactions from last 3 weeks
      const threeWeeksAgo = new Date(Date.now() - 3 * 7 * 24 * 60 * 60 * 1000);

      const [transactionsEth, transactionsSol] = await Promise.all([
        EtherTransaction.find({ timestamp: { $gte: threeWeeksAgo } }).lean(),
        SolTransaction.find({ timestamp: { $gte: threeWeeksAgo } }).lean(),
      ]);

      const tokenWalletInteractions = new Map<string, Set<string>>();
      const tokenSymbolCounts = new Map<string, number>();
      let processedTx = 0;

      const tokenData = new Map<string, TokenData>();

      // Update processTransaction function
      const processTransaction = (
        tx: any,
        wallet: string,
        symbols: (string | undefined)[],
        usdValue: number,
        isBuy: boolean,
        chain: "ETH" | "SOL"
      ) => {
        symbols.forEach((symbol) => {
          if (!symbol) return;

          if (!tokenWalletInteractions.has(symbol)) {
            tokenWalletInteractions.set(symbol, new Set());
            tokenSymbolCounts.set(symbol, 0);
            tokenData.set(symbol, {
              totalUsdValue: 0,
              buys: 0,
              sells: 0,
              walletNames: new Set(),
              chain,
            });
          }

          const walletSet = tokenWalletInteractions.get(symbol)!;
          const data = tokenData.get(symbol)!;

          if (!walletSet.has(wallet)) {
            walletSet.add(wallet);
            tokenSymbolCounts.set(
              symbol,
              (tokenSymbolCounts.get(symbol) || 0) + 1
            );
            data.totalUsdValue += usdValue;
            isBuy ? data.buys++ : data.sells++;
            // Get wallet name from address
            const ethWallet = walletsEth.find(
              (w) => w.wallets[0].toLowerCase() === wallet
            );
            const solWallet = walletsSol.find(
              (w) => w.wallets[0].toLowerCase() === wallet
            );
            const walletName =
              ethWallet?.username || solWallet?.username || wallet.slice(0, 8);
            data.walletNames.add(walletName);
            processedTx++;
          }
        });
      };

      // Process ETH transactions
      for (const tx of transactionsEth) {
        if (!tx.from || !tx.to) continue;

        const fromAddress = tx.from.toLowerCase();
        const toAddress = tx.to.toLowerCase();

        const wallet = ethAddresses.has(fromAddress)
          ? fromAddress
          : ethAddresses.has(toAddress)
          ? toAddress
          : null;

        if (wallet) {
          const isBuy = toAddress === wallet;
          const usdValue = tx.usdPrice || 0;
          processTransaction(
            tx,
            wallet,
            [tx.tokenSymbol, tx.tokenSymbol2],
            usdValue,
            isBuy,
            "ETH"
          );
        }
      }

      // Process SOL transactions
      for (const tx of transactionsSol) {
        if (!tx.from || !tx.to) continue;

        const fromAddress = tx.from.toLowerCase();
        const toAddress = tx.to.toLowerCase();

        const wallet = solAddresses.has(fromAddress)
          ? fromAddress
          : solAddresses.has(toAddress)
          ? toAddress
          : null;

        if (wallet) {
          const isBuy = toAddress === wallet;
          const usdValue = tx.totalUsdValue || 0;
          const inTokens = tx.inTokens?.map((t) => t.symbol) || [];
          const outTokens = tx.outTokens?.map((t) => t.symbol) || [];
          processTransaction(
            tx,
            wallet,
            [...inTokens, ...outTokens],
            usdValue,
            isBuy,
            "SOL"
          );
        }
      }

      const blacklistedTokens = new Set<string>([
        "WBTC",
        "WETH",
        "SOL",
        "ETH",
        "UNKNOWN",
      ]);

      const signalTransactions: SignalTransaction[] = [];

      for (const [symbol, count] of tokenSymbolCounts.entries()) {
        const data = tokenData.get(symbol)!;

        if (
          count <= 1 ||
          blacklistedTokens.has(symbol) ||
          Autoload.arrayStables.includes(symbol)
        )
          continue;

        // check if tx is already in db
        const existingTx = await SignalTransactions.findOne({
          tokenSymbol: symbol,
          type: data.buys >= data.sells ? "buy" : "sell",
        });
        if (existingTx) continue;

        const signalTx = new SignalTransactions({
          tokenSymbol: symbol,
          wallets: Array.from(tokenWalletInteractions.get(symbol) || []),
          usdValue: data.totalUsdValue,
          type: data.buys >= data.sells ? "buy" : "sell",
          walletNames: Array.from(data.walletNames),
          chain: data.chain,
        });
        signalTransactions.push(signalTx);
      }

      await SignalTransactions.insertMany(signalTransactions);
      setTimeout(() => Autoload.aggregateTransactions(), 30000);
    } catch (error) {
      Logger.error(`[AGGREGATE] Error: ${String(error)}`);
      setTimeout(() => Autoload.aggregateTransactions(), 60000);
    }
  }

  public static async fetchAndUpdateSolanaTransactions() {
    const LOOP_DELAY = 30000; // 30s or your preference

    async function processTransactions() {
      try {
        const wallets = await SolanaWallet.find();

        for (const wallet of wallets) {
          for (const address of wallet.wallets) {
            console.log(
              `\n[FETCH SOL] SWAPS for ${wallet.username} - ${address}`
            );
            await processSolSwaps(address, 10000); // 10000$ min value
          }
        }
      } catch (error) {
        console.error("Main SOL process error:", error);
        Logger.error(`Solana Swap Error: ${String(error)}`);
      }
    }

    // 1) initial call
    await processTransactions();

    // 2) schedule next run
    setTimeout(() => {
      Autoload.fetchAndUpdateSolanaTransactions();
    }, LOOP_DELAY);
  }

  public static async fetchAndUpdateTransactions() {
    const processTransactions = async () => {
      try {
        const wallets = await EthereumWallet.find();
        const currentTime = new Date();
        // Last 3 hours:
        const threeHoursAgo = Math.floor(
          (currentTime.getTime() - 3 * 60 * 60 * 1000) / 1000
        );

        for (const wallet of wallets) {
          for (const address of wallet.wallets) {
            console.log(
              `\n[FETCH] Transactions for ${wallet.username} - ${address}`
            );
            await delay(200);

            // 1) Fetch from Etherscan
            let transactions = await fetchEtherscanTxs(
              address,
              Autoload.ETH_APIKEY || ""
            );

            // Filter last 3 hours
            transactions = transactions
              .filter((tx: any) => parseInt(tx.timeStamp) >= threeHoursAgo)
              .sort(
                (a: any, b: any) =>
                  parseInt(b.timeStamp) - parseInt(a.timeStamp)
              );

            console.log(
              `=> After filtering 3 hours, count: ${transactions.length}`
            );

            const processedTxs = new Set<string>();
            let index = 0;

            for (const tx of transactions) {
              index++;
              try {
                if (processedTxs.has(tx.hash)) continue;
                processedTxs.add(tx.hash);

                console.log(
                  `[${index}/${transactions.length}] Checking tx: ${tx.hash}`
                );
                await delay(300);

                // 2) Fetch advanced info from Ethplorer
                const txData = await fetchEthplorerData(
                  tx.hash,
                  Autoload.ETHPLORER_APIKEY || ""
                );
                if (!txData) {
                  console.log(
                    `No Ethplorer data for tx ${tx.hash}, skipping...`
                  );
                  continue;
                }

                // Basic fields
                const realFrom = (txData.from || "").toLowerCase();
                const realTo = (txData.to || "").toLowerCase();
                const realValueETH = parseFloat(txData.value || "0"); // in ETH, not Wei
                const userAddr = address.toLowerCase();

                // 3) Parse operations (ERC-20, plus top-level ETH if any)
                const { tokenOperations, spentEthAmount } =
                  parseTokenOperations(
                    txData,
                    userAddr,
                    realFrom,
                    realTo,
                    realValueETH
                  );

                // 4) Classify
                const classification = classifyTransaction(
                  tokenOperations,
                  txData.operations || [],
                  userAddr,
                  spentEthAmount,
                  realFrom
                );
                const {
                  type,
                  tokenDetails,
                  outSymbols,
                  inSymbols,
                  totalUsdValue,
                  // New fields (the chosen single token's USD + marketCap)
                  chosenTokenUsdValue,
                  chosenTokenMarketCap,
                } = classification;

                // If under $10,000, skip (your custom cutoff)
                if (totalUsdValue < 2000) {
                  continue;
                }

                // Build summary
                const summary = buildSummary(type, tokenDetails);

                // Store in DB if not exist
                await storeTransactionIfNeeded(
                  tx,
                  tokenDetails,
                  type,
                  summary,
                  totalUsdValue,
                  outSymbols,
                  inSymbols,
                  chosenTokenUsdValue,
                  chosenTokenMarketCap
                );

                // Update wallet
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

    // Schedule next run
    setTimeout(() => {
      Autoload.fetchAndUpdateTransactions();
    }, 30000);
  }

  protected static async getTokenPriceAndSymbol(
    hash: string,
    tokenSymbol: string,
    walletAddress: string
  ) {
    // delay to keep under 10 req/s
    await new Promise((resolve) => setTimeout(resolve, 1000 / 10));
    try {
      const response = await axios.get(
        `https://api.ethplorer.io/getTxInfo/${hash}?apiKey=${Autoload.ETHPLORER_APIKEY}`
      );

      let tokenInfo = {} as any;
      let tokenPrice = 0;
      let tokenSymbol2 = "exchange";
      // for loop to get token different tokenSymbol than the one we are looking for (and if the from or to address field has the wallet address). If its the same, take the price
      for (let i = 0; i < response.data.operations.length; i++) {
        tokenInfo = response.data.operations[i].tokenInfo;
        if (
          tokenInfo.symbol !== tokenSymbol &&
          tokenInfo.symbol.toLowerCase() !== tokenSymbol.toLowerCase()
        ) {
          if (
            response.data.operations[i].from === walletAddress ||
            response.data.operations[i].to === walletAddress
          ) {
            tokenSymbol2 = tokenInfo.symbol;
          }
        } else {
          tokenPrice = tokenInfo.price.rate || 0;
        }
      }

      // Extract the price and symbol
      const price = tokenPrice;
      const symbol = tokenSymbol2;

      // Return the price and symbol
      return { price, symbol };
    } catch (error) {
      Logger.error(`Failed to fetch token price from Ethplorer: ${error}`);
      return { price: 0, symbol: "" };
    }
  }

  protected static rules() {
    // This is the function that sets the API rules
    if (!Autoload.app) return;
    Autoload.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Content-Type", "application/json");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
      );
      if (req.method === "OPTIONS") {
        res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,PATCH");
        return res.status(200).json({});
      }
      next();
    });
  }

  public static start() {
    Logger.beautifulSpace();
    Logger.info("Starting server...");
    DB_Connect().then(() => {
      Autoload.fetchAndUpdateTransactions(); // Ethereum
      // Autoload.fetchAndUpdateSolanaTransactions(); // Solana
      Autoload.aggregateTransactions(); // Aggregate into Signals
      Autoload.rules();
      if (Autoload.app) {
        Autoload.app.use(bearerToken());
        Autoload.app.use(express.json());
        Autoload.autoloadRoutesFromDirectory(path.join(__dirname, "../http"));

        Autoload.app.listen(Autoload.port, () => {
          Logger.success(`Server started on port ${Autoload.port}`);
        });
      }

      Logger.beautifulSpace();
      Autoload.logInfo();
      Logger.beautifulSpace();
    });
  }

  public static stop() {
    // This is the function that stops the server
    if (Autoload.socket) Autoload.socket.close();
    if (Autoload.app) Autoload.app.removeAllListeners();
  }
}
