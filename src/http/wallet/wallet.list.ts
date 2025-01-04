// src/http/wallet/wallet.list.ts

import express from "express";
import Wallet from "../../database/models/EtherWallet"

export default {
    name: "/wallet/list",
    description: "List all wallets",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await Wallet.findOne({token: req.token})) throw "Unauthorized access"
            const wallets = await Wallet.find();

            res.send(wallets);
            res.status(200); 
        }

        catch(err) {
            res.status(400)
            res.json({error: err});
        }
    }
}