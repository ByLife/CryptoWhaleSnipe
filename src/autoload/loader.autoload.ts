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
import EthereumWallet from "../database/models/Wallet";
import EtherTransaction from "../database/models/EtherTransaction";
import axios from "axios";

dotenv.config()

export class Autoload { // This is the class that starts the server
    static app: express.Express | null = Boolean(process.env.HTTP_API) == true ? express() : null;
    static socket: Socket.Server | null = Boolean(process.env.WEBSOCKETS_API) == true ? new Socket.Server(process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 3001) : null;
    static port: number = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 3000;
    static baseDir = path.resolve(__dirname, "../socket");
    static ETH_APIKEY = process.env.ETH_APIKEY;
    
    static rateLimitThreshold = 10000; // 10 000 Events par seconde
    static rateLimitDuration = 10000; // 1 seconde
    static clients = new Map();

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

    private static async fetchAndUpdateTransactions() {
        try {
            const wallets = await EthereumWallet.find();
            const currentTime = new Date();
            const yesterday = new Date(currentTime.setDate(currentTime.getDate() - 1)).setHours(0, 0, 0, 0) / 1000; // Start of yesterday in UNIX timestamp
    
            for (const wallet of wallets) {
                for (const address of wallet.wallets) {
                    // Rate limit control: Manage API calls to respect the rate limit
                    await new Promise(resolve => setTimeout(resolve, 1000 / 5)); // Delay to keep under 5 req/s
                    const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${Autoload.ETH_APIKEY}`;
                    Logger.warn(`Fetching transactions for wallet ${address}`);
                    try {
                        const response = await axios.get(url);
                        const transactions = response.data.result;
    
                        for (const tx of transactions) {
                            const timeStamp = parseInt(tx.timeStamp);
                            if (timeStamp >= yesterday) {
                                const tokenValue = Number(tx.value) / (10 ** tx.tokenDecimal);
                                const tokenValueInUsd = tokenValue * (await Autoload.getTokenPriceByContract(tx.contractAddress));
    
                                if (!await EtherTransaction.findOne({ hash: tx.hash }) && tokenValueInUsd >= 2000) {
                                    await new EtherTransaction(tx).save();
                                    Logger.info(`Saved new transaction ${tx.hash} for wallet ${address}`);
                                }
                            } 
                        }
                    } catch (error) {
                        console.error(`Error fetching transactions for wallet ${address}: ${error}`);
                    }
                }
            }
        } catch (error) {
            Logger.error(`Failed to fetch transactions: ${error}`);
        }
        setTimeout(Autoload.fetchAndUpdateTransactions, 5000);
    }
    
    
    protected static async getTokenPriceByContract(contractAddress: string) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`);
            const price = response.data.market_data.current_price.usd; 
            return price || 0; 
        } catch (error) {
            Logger.error(`Failed to fetch token price from CoinGecko: ${error}`);
            return 0; 
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

    public static start() { // This is the function that starts the server
        Logger.beautifulSpace()
        Logger.info("Starting server...")
        DB_Connect().then(() => {
            Autoload.fetchAndUpdateTransactions()
            Autoload.rules()
            if(Autoload.app) {
                Autoload.app.use(bearerToken())
                Autoload.app.use(express.json()) // This is the middleware that parses the body of the request to JSON format
                Autoload.autoloadRoutesFromDirectory(path.join(__dirname, '../http'));


                Autoload.app.listen(Autoload.port, () => {
                    Logger.success(`Server started on port ${Autoload.port}`)
                });
            }

            if(Autoload.socket){

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
