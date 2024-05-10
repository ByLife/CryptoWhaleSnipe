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
const AccessBearer_1 = __importDefault(require("../../database/models/AccessBearer"));
exports.default = {
    name: "/user/create",
    description: "Create a user",
    method: "POST",
    run: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.token)
                throw "Unauthorized access, missing 'token' in request header";
            if (!(yield AccessBearer_1.default.findOne({ token: req.token })))
                throw "Unauthorized access";
            if (!req.body.username)
                throw "Missing parameters in request body for creating a user";
            if (typeof req.body.username !== "string")
                throw "Invalid parameters in request body for creating a user, missing 'username'";
            const user = yield AccessBearer_1.default.findOne({ username: req.body.username });
            if (user) {
                res.status(200);
                res.send(user);
            }
            else {
                const jwt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("").sort(() => Math.random() - 0.5).join("").slice(0, 64);
                const newUser = new AccessBearer_1.default({
                    username: req.body.username,
                    token: jwt
                });
                yield newUser.save();
                res.status(200);
                res.send(newUser);
            }
        }
        catch (err) {
            res.status(400);
            res.json({ error: err });
        }
    })
};
