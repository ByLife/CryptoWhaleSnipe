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
  getEthUsdPrice,
  parseTokenOperations,
  storeTransactionIfNeeded,
} from "./utils/EthTransactionHelpers";
import { processSolSwaps } from "./utils/SolanaTransactionHelpers";
import SignalTransactions from "../database/models/SignalTransactions";
import { Buy, copyConfig, detectSignals, signalConfig, toBuy } from "./signals";
import { POLLED_WALLETS, walletStatusLoop } from "./walletStatus";
import { regimeLoop } from "./regime";
import { copyLoop } from "./copy";
import { paperLoop } from "./paper";

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
      const cfg = signalConfig();
      const now = new Date();
      const since = new Date(now.getTime() - 2 * cfg.windowDays * 86400_000);

      const [walletsEth, walletsSol] = await Promise.all([
        EthereumWallet.find().lean(),
        SolanaWallet.find().lean(),
      ]);
      // every address (not just wallets[0]) -> username
      const ethUser = new Map<string, string>();
      for (const w of walletsEth)
        for (const a of w.wallets || []) ethUser.set(a.toLowerCase(), w.username);
      const solUser = new Map<string, string>();
      for (const w of walletsSol)
        for (const a of w.wallets || []) solUser.set(a, w.username);

      const [txsEth, txsSol] = await Promise.all([
        EtherTransaction.find({ timestamp: { $gte: since } }).lean(),
        // SolTransaction has no `timestamp`, only blockTime (seconds)
        SolTransaction.find({ blockTime: { $gte: Math.floor(since.getTime() / 1000) } }).lean(),
      ]);

      const buys: Buy[] = [];
      for (const tx of txsEth) {
        const wallet = (
          tx.wallet ||
          [tx.from, tx.to].map((a) => (a || "").toLowerCase()).find((a) => ethUser.has(a)) ||
          ""
        ).toLowerCase();
        if (!wallet || !tx.timestamp) continue;
        const b = toBuy(tx, {
          chain: "ETH",
          username: ethUser.get(wallet) || wallet.slice(0, 8),
          wallet,
          at: new Date(tx.timestamp),
        });
        if (b) buys.push(b);
      }
      for (const tx of txsSol) {
        const wallet = [tx.from, tx.to].find((a) => a && solUser.has(a)) || "";
        if (!wallet || !tx.blockTime) continue;
        const b = toBuy(tx, {
          chain: "SOL",
          username: solUser.get(wallet) || wallet.slice(0, 8),
          wallet,
          at: new Date(tx.blockTime * 1000),
          fallbackToken: tx.contractAddress2,
        });
        if (b) buys.push(b);
      }

      const cooldownStart = new Date(now.getTime() - cfg.cooldownDays * 86400_000);
      const recent = await SignalTransactions.find(
        // copy signals have their own cooldown (copy.ts)
        { createdAt: { $gte: cooldownStart }, tokenAddress: { $exists: true }, type: { $ne: "copy" } },
        { chain: 1, tokenAddress: 1 }
      ).lean();
      const recentlySignaled = new Set(recent.map((s) => `${s.chain}:${s.tokenAddress}`));

      const signals = detectSignals(buys, cfg, now, recentlySignaled);
      if (signals.length) {
        await SignalTransactions.insertMany(
          signals.map((s) => ({ ...s, type: "buy", nWallets: s.walletNames.length }))
        );
        for (const s of signals)
          Logger.info(
            `[SIGNAL] ${s.fresh ? "NEW" : "late"} ${s.chain} ${s.tokenSymbol} ` +
              `${s.walletNames.length} wallets $${Math.round(s.usdValue)}`
          );
      }
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
        // active wallets + legacy ones never checked (dormant / standby are skipped)
        const wallets = await EthereumWallet.find(POLLED_WALLETS);
        const storeMinUsd = Number(process.env.MIN_STORE_USD ?? 2000);
        const smartMinUsd = Math.min(storeMinUsd, copyConfig().minBuyUsd);
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
                    realValueETH,
                    await getEthUsdPrice()
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

                // Skip small transactions (smart wallets: the copy bot copies buys >= $300)
                if (totalUsdValue < (wallet.smart ? smartMinUsd : storeMinUsd)) {
                  continue;
                }

                // Build summary
                const summary = buildSummary(type, tokenDetails);

                // Store in DB if not exist
                await storeTransactionIfNeeded(
                  { ...tx, wallet: userAddr },
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
      if (process.env.COPY_BOT_ENABLED !== "false") {
        regimeLoop(); // alt-season regime (copy bot ON/OFF)
        walletStatusLoop(); // dormant / active wallets, daily
        copyLoop(); // smart wallet buys -> COPY signals
        paperLoop(); // paper positions: TP x10 or 30 days
      }
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
