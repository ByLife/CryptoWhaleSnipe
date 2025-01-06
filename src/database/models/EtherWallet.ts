// src/database/models/EtherWallet.ts

import mongoose, { Document, Schema } from "mongoose";

export interface EthereumWallet {
  created_at: Date;
  balance: number;
  wallets: string[];
  username: string;
  orderType: string;
  lastTransaction: Date;
  influencer: boolean;
  image: string | null;
}

export interface EthereumWalletDocument extends EthereumWallet, Document {}

const EthereumWalletSchema = new Schema({
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

  orderType: {
    type: String,
    required: false,
    default: "buy",
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
});

export default mongoose.model<EthereumWalletDocument>(
  "EthereumWallet",
  EthereumWalletSchema
);
