// src/http/wallet/transaction/wallet.bnb.transaction.recent.ts

import express from "express";
import BnbTransaction from '../../../database/models/BnbTransaction';
import BnbWallet from '../../../database/models/BnbWallet';
import AccessBearer from "../../../database/models/AccessBearer";

export default {
    name: "/wallet/bnb/transaction/recent",
    description: "Get recent BNB chain transactions",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const oneDayAgoInSeconds = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
            const transactions = await BnbTransaction.find({
                timeStamp: { $gte: oneDayAgoInSeconds }
            }).lean();

            const results = [];
            for (const tx of transactions) {
                const wallet = await BnbWallet.findOne({
                    wallets: { $in: [tx.from, tx.to] }
                }).lean();

                if (!wallet) continue;

                const walletAddress = wallet.wallets.includes(tx.from) ? tx.from : tx.to;

                results.push({
                    username: wallet.username,
                    wallet: walletAddress,
                    tokenSymbol: tx.tokenSymbol,
                    hash: tx.hash,
                    gasUsed: tx.gasUsed,
                    timeStamp: tx.timeStamp,
                    usdPrice: tx.usdPrice,
                    value: tx.value,
                    type: tx.type,
                    tokenSymbol2: tx.tokenSymbol2,
                    influencer: wallet.influencer
                });
            }

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}