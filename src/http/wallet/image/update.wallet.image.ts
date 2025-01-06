// src/http/wallet/transaction/wallet.bnb.transaction.recent.ts

import express from "express";
import BnbTransaction from '../../../database/models/BnbTransaction';
import BnbWallet from '../../../database/models/BnbWallet';
import AccessBearer from "../../../database/models/AccessBearer";
import SolWallet from "../../../database/models/SolWallet";
import EtherWallet from "../../../database/models/EtherWallet";

export default {
    name: "/wallet/image/update",
    description: "Get recent BNB chain transactions",
    method: "POST",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            if(!req.body.image) throw "Missing 'image' in request body"
            if(!req.body.username) throw "Missing 'username' in request body"

            var wallet = await BnbWallet.findOne({
                username: req.body.username
            });

            if(wallet) {
                wallet.image = req.body.image;
                await wallet.save();

                const result = { wallet: wallet, message: "Wallet image updated" };

                return res.status(200).json(result);
            }

            wallet = await SolWallet.findOne({
                username: req.body.username
            });

            if(wallet) {
                wallet.image = req.body.image;
                await wallet.save();

                const result = { wallet: wallet, message: "Wallet image updated" };

                return res.status(200).json(result);
            }

            wallet = await EtherWallet.findOne({
                username: req.body.username
            });

            if(wallet) {
                wallet.image = req.body.image;
                await wallet.save();

                const result = { wallet: wallet, message: "Wallet image updated" };

                return res.status(200).json(result);
            }

            throw "Wallet not found";
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}