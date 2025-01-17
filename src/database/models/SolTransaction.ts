// src/database/models/SolTransaction.ts

import mongoose, { Document, Schema } from "mongoose";

interface SolTokenDetail {
  symbol: string;
  amount: number;
  usdValue?: number;
}

export interface SolanaTransaction {
  signature: string;
  blockTime: number;
  slot: number;
  swaps?: {
    tokenSymbol: string;
    amountChange: number;
    usdValue?: number;
  }[];

  outTokens?: SolTokenDetail[];
  inTokens?: SolTokenDetail[];
  finalToken?: SolTokenDetail;
  totalUsdValue?: number;
  from?: string;
  to?: string;
  type?: string;
}

const SolTokenDetailSchema = new Schema(
  {
    symbol: String,
    amount: Number,
    usdValue: Number,
  },
  { _id: false }
);

const SolanaTransactionSchema = new Schema({
  signature: { type: String, unique: true },
  blockTime: Number,
  slot: Number,

  outTokens: [SolTokenDetailSchema],
  inTokens: [SolTokenDetailSchema],
  finalToken: SolTokenDetailSchema,
  totalUsdValue: Number,

  from: String,
  to: String,
  type: String,
},{
  timestamps: true
});

export default mongoose.model<SolanaTransaction & Document>(
  "SolanaTransaction",
  SolanaTransactionSchema
);
