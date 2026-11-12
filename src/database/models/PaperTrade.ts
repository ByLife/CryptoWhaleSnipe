// src/database/models/PaperTrade.ts
// One simulated position per COPY signal (see autoload/paper.ts).

import mongoose, { Document, Schema } from "mongoose";

export type PaperStatus = "pending" | "open" | "closed" | "no_price";
export type ExitReason = "tp" | "time" | "dead";

export interface PaperTrade {
  signalId: string;
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  username: string;
  wallet: string;
  regimeOn: boolean; // regime when the signal fired (alerts only go out when ON)
  walletRoi?: number | null;
  qualified?: boolean; // buyer passed COPY_MIN_ROI
  buyAt: Date; // the smart wallet's buy (on-chain time)
  openedAt?: Date; // our simulated entry (first price seen after detection)
  entryPrice?: number;
  pairAddress?: string;
  lastPrice?: number;
  lastPriceAt?: Date;
  maxMultiple?: number;
  status: PaperStatus;
  closedAt?: Date;
  exitPrice?: number;
  exitReason?: ExitReason;
  returnPct?: number; // net of costs, e.g. 8.97 = +897%
}

const PaperTradeSchema = new Schema(
  {
    signalId: { type: String, required: true, unique: true },
    chain: String,
    tokenAddress: { type: String, index: true },
    tokenSymbol: String,
    username: String,
    wallet: String,
    regimeOn: Boolean,
    walletRoi: Number,
    qualified: Boolean,
    buyAt: Date,
    openedAt: Date,
    entryPrice: Number,
    pairAddress: String,
    lastPrice: Number,
    lastPriceAt: Date,
    maxMultiple: Number,
    status: { type: String, enum: ["pending", "open", "closed", "no_price"], index: true },
    closedAt: Date,
    exitPrice: Number,
    exitReason: String,
    returnPct: Number,
  },
  { timestamps: true }
);

export default mongoose.model<PaperTrade & Document>("PaperTrade", PaperTradeSchema);
