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
  nickname: string;
  // copy bot (see src/autoload/walletStatus.ts)
  smart?: boolean; // its buys trigger COPY alerts / paper trades
  source?: string; // manual | research-A3 | research-A2 | uptrend-winner | discovery-...
  status?: WalletStatus; // which wallets the tx loop polls
  cashUsd?: number | null; // ETH + WETH/USDC/USDT/DAI on all addresses
  lastSentAt?: Date | null; // last tx SENT by one of the addresses (received spam ignored)
  statusCheckedAt?: Date | null;
  // own realized $-ROI coefficient from the research (sum pnl / (sum cost + 5k));
  // copy alerts need roiCoef > COPY_MIN_ROI (null = unknown, e.g. manual wallets)
  roiCoef?: number | null;
}

// pending = imported, not checked yet; active = polled; standby = alive but over
// MAX_ACTIVE_WALLETS; dormant = nothing sent for DORMANT_DAYS and almost no cash
export type WalletStatus = "pending" | "active" | "standby" | "dormant";

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
  nickname: {
    type: String,
    required: false,
    default: null,
  },
  smart: { type: Boolean, default: false, index: true },
  source: { type: String, default: "manual" },
  // no default: legacy documents without a status keep being polled
  status: { type: String, enum: ["pending", "active", "standby", "dormant"], index: true },
  cashUsd: { type: Number, default: null },
  lastSentAt: { type: Date, default: null },
  statusCheckedAt: { type: Date, default: null },
  roiCoef: { type: Number, default: null },
});

export default mongoose.model<EthereumWalletDocument>(
  "EthereumWallet",
  EthereumWalletSchema
);
