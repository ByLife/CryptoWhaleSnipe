import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction';
import EthereumWallet from '../../../database/models/Wallet';
import AccessBearer from "../../../database/models/AccessBearer";

interface Transaction {
    [key: string]: any;
  }

interface Results {
    totalTransaction: number;
    transactions: {
        coin: string;
        transactionCount: number;
        totalAmount: number;
    }[];
}

export default {
    name: "/wallet/transaction/summary",
    description: "Get a summary of the last 24 hours transactions",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const results: Results = {
                totalTransaction: 0,
                transactions: []
            };

            const oneDayAgoInSeconds = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000); // Convert to seconds
            const transactions = await EtherTransaction.find({
                timeStamp: {
                    $gte: oneDayAgoInSeconds
                }
            }).lean();
            results.totalTransaction = transactions.length;

            // Group transactions by coin
            const transactionsByCoin: { [key: string]: Transaction[] } = {};
            for (const tx of transactions) {
                if (!transactionsByCoin[tx.tokenSymbol]) {
                    transactionsByCoin[tx.tokenSymbol] = [];
                }

                transactionsByCoin[tx.tokenSymbol].push(tx);
            }

            // Calculate total amount for each coin in $USD
            for (const coin in transactionsByCoin) {
                let totalAmount = 0;
                for (const tx of transactionsByCoin[coin]) {
                    totalAmount += tx.usdPrice;
                }

                if (totalAmount > 2000) { // Only show coins with total amount > 2000
                    results.transactions.push({
                        coin: coin,
                        transactionCount: transactionsByCoin[coin].length,
                        totalAmount: Math.round(totalAmount)
                    })
                }
            }

            // sort by Transaction Count
            results.transactions.sort((a, b) => {
                return b.transactionCount - a.transactionCount;
            });

            // { totalTransaction: 0, transactions: [{PEPE, 8, 1000000}, {BEAM, 3, 3000000}]} array of objects with coin, transaction count, totalAmount

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}