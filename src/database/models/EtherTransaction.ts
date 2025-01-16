// src/database/models/EtherTransaction.ts

import mongoose, { Document, Schema } from "mongoose";

interface TokenDetail {
    symbol: string;
    amount: number;
    usdValue: number;
}

export interface EtherTransaction {
    blockNumber?: string;
    timeStamp?: string;
    hash: string;
    nonce?: string;
    transactionIndex?: string;
    from?: string;
    to?: string;
    value?: number;
    gas?: string;
    gasPrice?: string;
    isError?: string;
    input?: string;
    contractAddress?: string;
    cumulativeGasUsed?: string;
    gasUsed?: string;
    confirmations?: string;
    methodId?: string;
    functionName?: string;
    tokenName?: string;
    tokenSymbol?: string;
    tokenDecimal?: number;
    usdPrice?: number;
    type: string;
    tokenSymbol2?: string;
    marketCap?: number;
    singleTransaction?: boolean;
    summary?: string;
    outTokens?: TokenDetail[];
    inTokens?: TokenDetail[];
    finalToken?: TokenDetail | null;
    totalUsdValue?: number;
    timestamp?: Date;
    singleTokenUsdValue?: number;
    singleTokenMarketCap?: number;
}

const TokenDetailSchema = new Schema({
    symbol: String,
    amount: Number,
    usdValue: Number
}, { _id: false }); // Disable _id for subdocuments

const EtherTransactionSchema = new Schema({
    blockNumber: String,
    timeStamp: String,
    hash: { type: String, unique: true }, // Add unique index
    nonce: String,
    transactionIndex: String,
    from: String,
    to: String,
    value: Number,
    gas: String,
    gasPrice: String,
    isError: String,
    input: String,
    contractAddress: String,
    cumulativeGasUsed: String,
    gasUsed: String,
    confirmations: String,
    methodId: String,
    functionName: String,
    tokenName: String,
    tokenSymbol: String,
    tokenDecimal: Number,
    usdPrice: Number,
    type: String,
    tokenSymbol2: String,
    marketCap: Number,
    singleTransaction: Boolean,
    singleTokenUsdValue: Number,
    singleTokenMarketCap: Number,

    // New
    summary: String,
    outTokens: [TokenDetailSchema],
    inTokens: [TokenDetailSchema],
    finalToken: TokenDetailSchema,
    totalUsdValue: Number,
    timestamp: Date
}, {
    timestamps: true // Add createdAt and updatedAt fields
});

EtherTransactionSchema.index({ hash: 1 });
EtherTransactionSchema.index({ timestamp: -1 });
EtherTransactionSchema.index({ type: 1 });

export default mongoose.model<Document & EtherTransaction>("EtherTransaction", EtherTransactionSchema);