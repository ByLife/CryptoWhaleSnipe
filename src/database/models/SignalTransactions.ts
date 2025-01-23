// src/database/models/SignalTransactions?.ts

import mongoose, { Document, Schema } from "mongoose";

export interface SignalTransaction {
    tokenSymbol: string;
    usdValue?: number;
    wallets?: string[];
    walletNames?: string[];
    type?: string;
    chain?: string;
}

const SignalTransactionSchema = new Schema({
    tokenSymbol: String,
    usdValue: Number,
    chain: String,
    wallets: [String],
    walletNames: [String],
    type: String
},{
  timestamps: true
});

export default mongoose.model<SignalTransaction & Document>(
  "SignalTransaction",
  SignalTransactionSchema
);
