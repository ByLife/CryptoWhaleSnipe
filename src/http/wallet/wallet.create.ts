// src/http/wallet/wallet.create.ts

import express from "express";
import EthereumWallet from "../../database/models/EtherWallet";
import SolanaWallet from "../../database/models/SolWallet";
import AccessBearer from "../../database/models/AccessBearer";

export default {
    name: "/wallet/create",
    description: "Create a wallet",
    method: "POST",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"
            if(!req.body.username || !req.body.wallets || !req.body.chain) throw "Missing parameters in request body: 'username', 'wallets', or 'chain' required"
            if(typeof req.body.username !== "string" || !Array.isArray(req.body.wallets)) throw "Invalid parameters: username must be string and wallets must be array"
            if(req.body.wallets.length < 1) throw "Wallets array must have at least one element"
            if(!['ethereum', 'bnb', 'solana'].includes(req.body.chain)) throw "Invalid chain type. Must be: ethereum, bnb, or solana"
            
            for(let wallet of req.body.wallets) {
                if(typeof wallet !== "string") throw "Invalid parameters: wallets must be an array of strings"
            }

            if(req.body.influencer && typeof req.body.influencer !== "boolean") throw "Invalid parameters: influencer must be a boolean"

            // Make wallets lowercase for ethereum and bnb
            const wallets = req.body.chain !== 'solana' 
                ? req.body.wallets.map((wallet: string) => wallet.toLowerCase())
                : req.body.wallets;

            let wallet;
            let savedWallet;
            let image = req.body.image ? req.body.image : null;
            let nickname = req.body.nickname ? req.body.nickname : null;

            switch(req.body.chain) {
                case 'ethereum':
                    wallet = await EthereumWallet.findOne({username: req.body.username});
                    if(wallet) {
                        wallet.wallets = [...new Set([...wallet.wallets, ...wallets])];
                        savedWallet = await wallet.save();
                    } else {
                        savedWallet = await new EthereumWallet({
                            username: req.body.username,
                            wallets: wallets,
                            influencer: req.body.influencer,
                            image,
                            nickname
                        }).save();
                    }
                    break;


                case 'solana':
                    wallet = await SolanaWallet.findOne({username: req.body.username});
                    if(wallet) {
                        wallet.wallets = [...new Set([...wallet.wallets, ...wallets])];
                        savedWallet = await wallet.save();
                    } else {
                        savedWallet = await new SolanaWallet({
                            username: req.body.username,
                            wallets: wallets,
                            influencer: req.body.influencer,
                            image,
                            nickname
                        }).save();
                    }
                    break;
            }

            res.status(200);
            res.send(savedWallet);
        }
        catch(err) {
            res.status(400);
            res.json({error: err});
        }
    }
}