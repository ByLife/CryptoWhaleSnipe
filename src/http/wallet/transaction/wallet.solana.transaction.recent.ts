// src/http/wallet/transaction/wallet.solana.transaction.recent.ts

import express from "express";
import SolTransaction from '../../../database/models/SolTransaction';
import SolanaWallet from '../../../database/models/SolWallet';
import AccessBearer from "../../../database/models/AccessBearer";

export default {
    name: "/wallet/solana/transaction/recent",
    description: "Get recent Solana transactions",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
            const transactions = await SolTransaction.find({
                blockTime: { $gte: oneDayAgo }
            }).lean();

            const results = [];
            for (const tx of transactions) {
                const wallet = await SolanaWallet.findOne({
                    wallets: { $in: [tx.from, tx.to] }
                }).lean();

                if (!wallet) continue;

                const totalUsdValue = tx.swaps.reduce((acc, swap) => acc + (swap.usdValue || 0), 0);

                if (totalUsdValue >= 10000) {
                    results.push({
                        username: wallet.username,
                        wallet: wallet.wallets[0],
                        signature: tx.signature,
                        blockTime: tx.blockTime,
                        swaps: tx.swaps,
                        totalUsdValue: totalUsdValue,
                        type: tx.type,
                        influencer: wallet.influencer
                    });
                }
            }

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}