// src/database/models/SolWallet.ts

import mongoose, { Document, Schema } from "mongoose";

export interface SolanaWallet {
    created_at: Date; 
    balance: number; 
    wallets: string[];
    username: string; 
    lastTransaction: Date;
}

export interface SolanaWalletDocument extends SolanaWallet, Document {}

const SolanaWalletSchema = new Schema({
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
    lastTransaction: {
        type: Date,
        required: false,
        default: null
    }
});

export default mongoose.model<SolanaWalletDocument>("SolanaWallet", SolanaWalletSchema);
