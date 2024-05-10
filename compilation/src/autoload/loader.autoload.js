"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Autoload = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = __importDefault(require("../logger"));
const connect_database_1 = __importDefault(require("../database/connect.database"));
const socket_io_1 = __importDefault(require("socket.io"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../../config");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const express_bearer_token_1 = __importDefault(require("express-bearer-token"));
const Wallet_1 = __importDefault(require("../database/models/Wallet"));
const EtherTransaction_1 = __importDefault(require("../database/models/EtherTransaction"));
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
class Autoload {
    constructor() {
        Autoload.port = Number(process.env.HTTP_PORT) || 3000;
        //Autoload.app.use(Autoload.rateLimiter)
        Autoload.start();
        logger_1.default.success("Server started on port " + Autoload.port);
    }
    // Rate limiter methods
    static isRateLimited(socketId) {
        const record = Autoload.clients.get(socketId);
        if (!record)
            return false;
        return record.requests > Autoload.rateLimitThreshold;
    }
    static rateLimiterMiddleware(socket, handler) {
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
            logger_1.default.warn(`Requests from socket ${socketId} are currently blocked due to rate limit.`);
            return; // Just return without processing the request
        }
        handler();
    }
    static autoloadRoutesFromDirectory(directory) {
        if (!Autoload.app)
            return;
        const httpMethods = ["get", "post", "put", "delete", "patch", "head", "options"];
        const files = fs_1.default.readdirSync(directory);
        for (const file of files) {
            const fullPath = path_1.default.join(directory, file);
            if (fs_1.default.statSync(fullPath).isDirectory()) {
                Autoload.autoloadRoutesFromDirectory(fullPath);
            }
            else if (file.endsWith('.ts') || file.endsWith('.js')) {
                const route = require(fullPath).default;
                if (route && typeof route.run === 'function' && route.method && route.name) {
                    const httpMethod = route.method.toLowerCase();
                    if (httpMethods.includes(httpMethod)) {
                        Autoload.app[httpMethod](`/api${route.name}`, route.run);
                        logger_1.default.info(`Loaded route ${route.method} /api${route.name}`);
                    }
                    else {
                        logger_1.default.warn(`Unknown HTTP method: ${route.method}`);
                    }
                }
            }
        }
    }
    static autoloadFilesFromDirectory(directory) {
        const handlers = [];
        const files = fs_1.default.readdirSync(directory);
        for (const file of files) {
            const fullPath = path_1.default.join(directory, file);
            if (fs_1.default.statSync(fullPath).isDirectory()) {
                handlers.push(...Autoload.autoloadFilesFromDirectory(fullPath));
            }
            else if (file.endsWith('.ts')) {
                const handler = require(fullPath).default;
                handlers.push(handler);
            }
        }
        return handlers;
    }
    static attachHandlersToSocket(socket) {
    }
    static fetchAndUpdateTransactions() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const wallets = yield Wallet_1.default.find();
                const currentTime = new Date();
                const yesterday = new Date(currentTime.setDate(currentTime.getDate() - 1)).setHours(0, 0, 0, 0) / 1000; // Start of yesterday in UNIX timestamp
                for (const wallet of wallets) {
                    for (const address of wallet.wallets) {
                        // Rate limit control: Manage API calls to respect the rate limit
                        yield new Promise(resolve => setTimeout(resolve, 1000 / 5)); // Delay to keep under 5 req/s
                        const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${Autoload.ETH_APIKEY}`;
                        logger_1.default.warn(`Fetching transactions for wallet ${address}`);
                        try {
                            const response = yield axios_1.default.get(url);
                            const transactions = response.data.result;
                            for (const tx of transactions) {
                                const timeStamp = parseInt(tx.timeStamp);
                                if (timeStamp >= yesterday) {
                                    const tokenValue = Number(tx.value) / (Math.pow(10, tx.tokenDecimal));
                                    const tokenValueInUsd = tokenValue * (yield Autoload.getTokenPriceByContract(tx.contractAddress));
                                    if (!(yield EtherTransaction_1.default.findOne({ hash: tx.hash })) && tokenValueInUsd >= 2000) {
                                        yield new EtherTransaction_1.default(tx).save();
                                        logger_1.default.info(`Saved new transaction ${tx.hash} for wallet ${address}`);
                                    }
                                }
                            }
                        }
                        catch (error) {
                            console.error(`Error fetching transactions for wallet ${address}: ${error}`);
                        }
                    }
                }
            }
            catch (error) {
                logger_1.default.error(`Failed to fetch transactions: ${error}`);
            }
            setTimeout(Autoload.fetchAndUpdateTransactions, 5000);
        });
    }
    static getTokenPriceByContract(contractAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            yield new Promise(resolve => setTimeout(resolve, 5000));
            try {
                const response = yield axios_1.default.get(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`);
                const price = response.data.market_data.current_price.usd;
                return price || 0;
            }
            catch (error) {
                logger_1.default.error(`Failed to fetch token price from CoinGecko: ${error}`);
                return 0;
            }
        });
    }
    static rules() {
        if (!Autoload.app)
            return;
        Autoload.app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header('Content-Type', 'application/json');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            if (req.method === 'OPTIONS') {
                res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH');
                return res.status(200).json({});
            }
            next();
        });
    }
    static start() {
        logger_1.default.beautifulSpace();
        logger_1.default.info("Starting server...");
        (0, connect_database_1.default)().then(() => {
            Autoload.fetchAndUpdateTransactions();
            Autoload.rules();
            if (Autoload.app) {
                Autoload.app.use((0, express_bearer_token_1.default)());
                Autoload.app.use(express_1.default.json()); // This is the middleware that parses the body of the request to JSON format
                Autoload.autoloadRoutesFromDirectory(path_1.default.join(__dirname, '../http'));
                Autoload.app.listen(Autoload.port, () => {
                    logger_1.default.success(`Server started on port ${Autoload.port}`);
                });
            }
            if (Autoload.socket) {
            }
            logger_1.default.beautifulSpace();
            Autoload.logInfo();
            logger_1.default.beautifulSpace();
        });
    }
    static stop() {
        if (Autoload.socket)
            Autoload.socket.close();
        if (Autoload.app)
            Autoload.app.removeAllListeners();
    }
}
exports.Autoload = Autoload;
Autoload.app = Boolean(process.env.HTTP_API) == true ? (0, express_1.default)() : null;
Autoload.socket = Boolean(process.env.WEBSOCKETS_API) == true ? new socket_io_1.default.Server(process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 3001) : null;
Autoload.port = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 3000;
Autoload.baseDir = path_1.default.resolve(__dirname, "../socket");
Autoload.ETH_APIKEY = process.env.ETH_APIKEY;
Autoload.rateLimitThreshold = 10000; // 10 000 Events par seconde
Autoload.rateLimitDuration = 10000; // 1 seconde
Autoload.clients = new Map();
Autoload.logInfo = () => {
    // ${config.application.description}
    logger_1.default.normal(`
        ${config_1.config.ascii.art}

        Version: ${config_1.config.api.version}
        Port: ${Number(process.env.HTTP_PORT) || 3000}
        `);
    // Owners: ${config.application.owners.join(", ")}
};
