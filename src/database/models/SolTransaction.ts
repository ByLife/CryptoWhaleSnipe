// src/database/models/SolTransaction.ts

import mongoose, { Document, Schema } from "mongoose";

export interface SolanaTransaction {
  signature: string;
  blockTime: number;
  slot: number;
  swaps: {
    tokenSymbol: string;
    amountChange: number;
    usdValue?: number;
  }[];
  from?: string;
  to?: string;
  type?: string;
}

const SolanaTransactionSchema = new Schema({
  signature: String,
  blockTime: Number,
  slot: Number,
  swaps: [
    {
      tokenSymbol: String,
      amountChange: Number,
      usdValue: Number,
    },
  ],
  from: String,
  to: String,
  type: String,
});

export default mongoose.model<Document & SolanaTransaction>(
  "SolanaTransaction",
  SolanaTransactionSchema
);
