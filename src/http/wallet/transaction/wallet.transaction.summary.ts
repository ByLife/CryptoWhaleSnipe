import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction';
import EthereumWallet from '../../../database/models/Wallet';
import AccessBearer from "../../../database/models/AccessBearer";

export default {
    name: "/wallet/transaction/summary",
    description: "Get recent transactions summary",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const results = {} // get a summary of the last 24 hours transactions

            // { totalTransaction: 0, transactions: [{PEPE, 8, 1000000}, {BEAM, 3, 3000000}]} array of objects with coin, transaction count, totalAmount

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}