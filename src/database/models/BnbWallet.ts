// src/database/models/BnbWallet.ts

import mongoose, {Document, Schema} from "mongoose";

export interface BnbWallet {
    created_at: Date;
    balance: number;
    wallets: string[];
    username: string;
    orderType: string;
    lastTransaction: Date;
}

export interface BnbWalletDocument extends BnbWallet, Document {}

const BnbWalletSchema = new Schema({
    created_at: {
        type: Date,
        default: Date.now
    },
    balance: {
        type: Number,
        required: false,
        default: null
    },
    wallets: {
        type: [String],
        required: true
    },
    username: {
        type: String,
        required: true
    },
    orderType: {
        type: String,
        required: false,
        default: "buy"
    },
    lastTransaction: {
        type: Date,
        required: false,
        default: null
    }
});

export default mongoose.model<BnbWalletDocument>("BnbWallet", BnbWalletSchema);