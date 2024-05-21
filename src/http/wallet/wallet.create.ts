import express from "express";
import Wallet from "../../database/models/Wallet"
import AccessBearer from "../../database/models/AccessBearer";

export default {
    name: "/wallet/create",
    description: "Create a user",
    method: "POST",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"
            if(!req.body.username || !req.body.wallets) throw "Missing parameters in request body for creating a user, missing 'username' or 'wallets'"
            if(typeof req.body.username !== "string" || !Array.isArray(req.body.wallets)) throw "Invalid parameters in request body for creating a user, username is not a string or wallets is not an array"
            if(req.body.wallets.length < 1) throw "Wallets array must have at least one element"
            for(let wallet of req.body.wallets) {
                if(typeof wallet !== "string") throw "Invalid parameters in request body for creating a user, wallets is not an array of strings"
            }

            const wallet = await Wallet.findOne({username: req.body.username})

            // make wallets lowercase
            req.body.wallets = req.body.wallets.map((wallet: string) => wallet.toLowerCase());
            if(wallet) {
                wallet.wallets.concat(req.body.wallets)
                await wallet.save()
                res.status(200)
                res.send(wallet)
            } else {
                const newWallet = new Wallet({
                    username: req.body.username,
                    wallets: req.body.wallets
                })
                await newWallet.save()
                res.status(200)
                res.send(newWallet)
            }
        }

        catch(err) {
            res.status(400)
            res.json({error: err});
        }
    }
}