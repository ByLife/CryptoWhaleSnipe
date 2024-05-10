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
const EtherTransaction_1 = __importDefault(require("../../../database/models/EtherTransaction")); // Assurez-vous que ce chemin est correct
const Wallet_1 = __importDefault(require("../../../database/models/Wallet")); // Assurez-vous que ce chemin est correct
exports.default = {
    name: "/wallet/transaction/recent",
    description: "Get recent transactions",
    method: "GET",
    run: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.token)
                throw "Unauthorized access, missing 'token' in request header";
            if (!(yield Wallet_1.default.findOne({ token: req.token })))
                throw "Unauthorized access";
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const transactions = yield EtherTransaction_1.default.find({
                timeStamp: { $gte: oneDayAgo.getTime() / 1000 }
            }).lean();
            const results = [];
            for (const tx of transactions) {
                const wallet = yield Wallet_1.default.findOne({
                    wallets: tx.from
                }).lean();
                if (wallet) {
                    results.push({
                        username: wallet.username,
                        wallet: tx.from,
                        tokenSymbol: tx.tokenSymbol,
                        hash: tx.hash,
                        gasUsed: tx.gasUsed
                    });
                }
            }
            res.status(200).json(results);
        }
        catch (error) {
            res.status(400).json({ error: error });
        }
    })
};
