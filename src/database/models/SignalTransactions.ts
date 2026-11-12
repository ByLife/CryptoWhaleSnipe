// src/database/models/SignalTransactions.ts

import mongoose, { Document, Schema } from "mongoose";

export interface SignalTransaction {
    tokenSymbol: string;
    tokenAddress?: string;
    usdValue?: number;
    wallets?: string[];
    walletNames?: string[];
    nWallets?: number;
    type?: string;
    chain?: string;
    firstBuyAt?: Date;
    signalAt?: Date;
    // false = detected late (e.g. after a restart); stored but not broadcast
    fresh?: boolean;
    // type "exit": the buy signal this exit belongs to
    parentSignal?: string;
    // type "copy": market regime when it fired (alerts are only sent when ON)
    regimeOn?: boolean;
    // type "copy": buyer's roiCoef and whether it passes COPY_MIN_ROI (alert = regimeOn && qualified)
    walletRoi?: number | null;
    qualified?: boolean;
}

const SignalTransactionSchema = new Schema({
    tokenSymbol: String,
    tokenAddress: { type: String, index: true },
    usdValue: Number,
    chain: String,
    wallets: [String],
    walletNames: [String],
    nWallets: Number,
    type: String,
    firstBuyAt: Date,
    signalAt: Date,
    fresh: { type: Boolean, default: true },
    parentSignal: { type: String, index: true },
    regimeOn: Boolean,
    walletRoi: Number,
    qualified: Boolean,
},{
  timestamps: true
});

export default mongoose.model<SignalTransaction & Document>(
  "SignalTransaction",
  SignalTransactionSchema
);
