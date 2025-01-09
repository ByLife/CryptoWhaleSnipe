// src/database/models/SolWallet.ts

import mongoose, { Document, Schema } from "mongoose";

export interface SolanaWallet {
  created_at: Date;
  balance: number;
  wallets: string[];
  username: string;
  lastTransaction: Date;
  influencer: boolean;
  image: string | null;
  nickname: string;
}

export interface SolanaWalletDocument extends SolanaWallet, Document {}

const SolanaWalletSchema = new Schema({
  created_at: {
    type: Date,
    default: Date.now,
  },
  balance: {
    type: Number,
    required: false,
    default: null,
  },
  wallets: {
    type: [String],
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  lastTransaction: {
    type: Date,
    required: false,
    default: null,
  },
  influencer: {
    type: Boolean,
    required: true,
    default: false,
  },
  image: {
    type: String,
    required: false,
    default: null,
  },
  nickname: {
    type: String,
    required: false,
  },
});

export default mongoose.model<SolanaWalletDocument>(
  "SolanaWallet",
  SolanaWalletSchema
);
