// src/http/wallet/transaction/wallet.eth.transaction.recent.ts

import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction';
import EthereumWallet from '../../../database/models/EtherWallet';
import AccessBearer from "../../../database/models/AccessBearer";
import SolTransaction from "../../../database/models/SolTransaction";


export default {
    name: "/wallet/aggregated/transaction/recent",
    description: "Get list of Coins where 2 or more wallets have bought or 2 or more wallets have sold in the last 3 weeks",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const threeWeeksAgo = new Date(Date.now() - 3 * 7 * 24 * 60 * 60 * 1000);
            const transactionsEth = await EtherTransaction.find({
                timestamp: {
                    $gte: threeWeeksAgo
                }
            }).lean();

            const transactionsSol = await SolTransaction.find({
                timestamp: {
                    $gte: threeWeeksAgo
                }
            }).lean();

            const results: any = [];
            

            }

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}