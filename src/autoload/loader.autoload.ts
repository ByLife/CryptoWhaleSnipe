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
            const yesterday = new Date(currentTime.setDate(currentTime.getDate() - 1)).setHours(0, 0, 0, 0) / 1000;
    
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
    

    private static async fetchAndUpdateTransactions() {
        const processTransactions = async () => {
            try {
                const wallets = await EthereumWallet.find();
                const currentTime = new Date();
                const yesterday = new Date(currentTime.setDate(currentTime.getDate() - 1)).setHours(0, 0, 0, 0) / 1000;
    
                const transactionCount = await EtherTransaction.countDocuments();
                if (transactionCount === 0) {
                    await EthereumWallet.updateMany({}, { $set: { lastTransaction: new Date(0) } });
                }
    
                for (const wallet of wallets) {
                    for (const address of wallet.wallets) {
                        await new Promise(resolve => setTimeout(resolve, 1000 / 5));
                        const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${Autoload.ETH_APIKEY}`;
    
                        try {
                            const response = await axios.get(url);
                            if (!response.data?.result) continue;
                            
                            let transactions = response.data.result
                                .filter((tx: any) => parseInt(tx.timeStamp) >= yesterday)
                                .filter((tx: any) => !transactionCount || wallet.lastTransaction < new Date(parseInt(tx.timeStamp) * 1000));
    
                            const processedTxs = new Set();
                            
                            for (const tx of transactions) {
                                try {
                                    if (processedTxs.has(tx.hash)) continue;
                                    processedTxs.add(tx.hash);
    
                                    const ethplorerResponse = await axios.get(
                                        `https://api.ethplorer.io/getTxInfo/${tx.hash}?apiKey=${Autoload.ETHPLORER_APIKEY}`
                                    );
    
                                    if (!ethplorerResponse.data?.operations) continue;
    
                                    const operations = ethplorerResponse.data.operations;
                                    
                                    // Get all operations involving our address
                                    const ourOps = operations.filter((op: any) => 
                                        op?.from?.toLowerCase() === address.toLowerCase() || 
                                        op?.to?.toLowerCase() === address.toLowerCase()
                                    );
    
                                    if (ourOps.length < 2) continue;
    
                                    const outgoingOp = ourOps.find((op:any) => op.from.toLowerCase() === address.toLowerCase());
                                    const incomingOp = ourOps.find((op:any) => op.to.toLowerCase() === address.toLowerCase());
    
                                    if (!outgoingOp || !incomingOp) continue;
    
                                    const outValue = Number(outgoingOp.value) * (outgoingOp.tokenInfo?.price?.rate || 0);
                                    const inValue = Number(incomingOp.value) * (incomingOp.tokenInfo?.price?.rate || 0);
                                    
                                    let mainOp, otherOp, type;
                                    if (outValue > inValue) {
                                        mainOp = outgoingOp;
                                        otherOp = incomingOp;
                                        type = "sell";
                                    } else {
                                        mainOp = incomingOp;
                                        otherOp = outgoingOp;
                                        type = "buy";
                                    }
    
                                    const tokenValue = Number(mainOp.value) / (10 ** mainOp.tokenInfo.decimals);
                                    const tokenValueInUsd = tokenValue * (mainOp.tokenInfo.price?.rate || 0);
    
                                    if (await EtherTransaction.findOne({ hash: tx.hash }) || 
                                        tokenValueInUsd < 10000 || tokenValueInUsd > 5000000) continue;
    
                                    const newTransaction = new EtherTransaction({
                                        blockNumber: tx.blockNumber,
                                        timeStamp: tx.timeStamp,
                                        hash: tx.hash,
                                        nonce: tx.nonce,
                                        transactionIndex: tx.transactionIndex,
                                        from: mainOp.from,
                                        to: mainOp.to,
                                        value: tokenValueInUsd,
                                        gas: tx.gas,
                                        gasPrice: tx.gasPrice,
                                        isError: tx.isError,
                                        input: "deprecated",
                                        contractAddress: mainOp.tokenInfo.address,
                                        cumulativeGasUsed: tx.cumulativeGasUsed,
                                        gasUsed: tx.gasUsed,
                                        confirmations: tx.confirmations,
                                        methodId: tx.methodId,
                                        functionName: tx.functionName,
                                        tokenName: mainOp.tokenInfo.name,
                                        tokenSymbol: mainOp.tokenInfo.symbol,
                                        tokenSymbol2: otherOp.tokenInfo.symbol,
                                        tokenDecimal: mainOp.tokenInfo.decimals,
                                        usdPrice: tokenValueInUsd,
                                        type: type
                                    });
    
                                    await newTransaction.save();
                                    Logger.success(`Saved ${type} transaction ${tx.hash}: ${mainOp.tokenInfo.symbol} -> ${otherOp.tokenInfo.symbol}`);
    
                                    wallet.lastTransaction = new Date();
                                    await wallet.save();
                                } catch (error) {
                                    Logger.error(`TX Error ${tx.hash}: ${error}`);
                                }
                            }
                        } catch (error) {
                            Logger.error(`Wallet Error ${address}: ${error}`);
                        }
                    }
                }
            } catch (error) {
                Logger.error(`Fetch Error: ${error}`);
            }
        };
    
        // Initial call
        await processTransactions();
        
        // Schedule next run
        setTimeout(() => {
            Autoload.fetchAndUpdateTransactions();
        }, 100);
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
