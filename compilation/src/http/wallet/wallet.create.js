"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Wallet_1 = __importDefault(require("../../database/models/Wallet"));
exports.default = {
    name: "/wallet/create",
    description: "Create a user",
    method: "POST",
    run: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.token)
                throw "Unauthorized access, missing 'token' in request header";
            if (!(yield Wallet_1.default.findOne({ token: req.token })))
                throw "Unauthorized access";
            if (!req.body.username || !req.body.wallets)
                throw "Missing parameters in request body for creating a user, missing 'username' or 'wallets'";
            if (typeof req.body.username !== "string" || !Array.isArray(req.body.wallets))
                throw "Invalid parameters in request body for creating a user, username is not a string or wallets is not an array";
            if (req.body.wallets.length < 1)
                throw "Wallets array must have at least one element";
            const wallet = yield Wallet_1.default.findOne({ username: req.body.username });
            if (wallet) {
                wallet.wallets.concat(req.body.wallets);
                yield wallet.save();
                res.status(200);
                res.send(wallet);
            }
            else {
                const newWallet = new Wallet_1.default({
                    username: req.body.username,
                    wallets: [req.body.wallets]
                });
                yield newWallet.save();
                res.status(200);
                res.send(newWallet);
            }
        }
        catch (err) {
            res.status(400);
            res.json({ error: err });
        }
    })
};
