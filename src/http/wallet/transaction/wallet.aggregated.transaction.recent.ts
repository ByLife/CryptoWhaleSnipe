// src/http/wallet/transaction/wallet.eth.transaction.recent.ts

import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction';
import EthereumWallet from '../../../database/models/EtherWallet';
import AccessBearer from "../../../database/models/AccessBearer";
import SolTransaction from "../../../database/models/SolTransaction";
import SignalTransactions from "../../../database/models/SignalTransactions";


export default {
    name: "/wallet/aggregated/transaction/recent",
    description: "Get list of Coins where 2 or more wallets have bought or 2 or more wallets have sold in the last 3 weeks",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const threehoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

            const signals = await SignalTransactions.find({
                createdAt: { $gte: threehoursAgo }
            });

            res.status(200).json({ signals });
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}