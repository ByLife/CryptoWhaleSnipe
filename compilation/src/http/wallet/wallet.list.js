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
    name: "/wallet/list",
    description: "List all wallets",
    method: "GET",
    run: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.token)
                throw "Unauthorized access, missing 'token' in request header";
            if (!(yield Wallet_1.default.findOne({ token: req.token })))
                throw "Unauthorized access";
            const wallets = yield Wallet_1.default.find();
            res.send(wallets);
            res.status(200);
        }
        catch (err) {
            res.status(400);
            res.json({ error: err });
        }
    })
};
