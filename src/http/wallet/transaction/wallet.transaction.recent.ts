import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction'; // Assurez-vous que ce chemin est correct
import EthereumWallet from '../../../database/models/Wallet'; // Assurez-vous que ce chemin est correct

export default {
    name: "/wallet/transaction/recent",
    description: "Get recent transactions",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await EthereumWallet.findOne({token: req.token})) throw "Unauthorized access"
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const transactions = await EtherTransaction.find({
                timeStamp: { $gte: oneDayAgo.getTime() / 1000 }
            }).lean();

            const results = [];
            for (const tx of transactions) {
                const wallet = await EthereumWallet.findOne({
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
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}