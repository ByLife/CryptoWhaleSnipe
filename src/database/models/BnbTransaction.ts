// src/database/models/BnbTransaction.ts

import mongoose, { Document, Schema } from "mongoose";

export interface BnbTransaction {
    blockNumber: string;
    timeStamp: string;
    hash: string;
    nonce: string;
    transactionIndex: string;
    from: string;
    to: string;
    value: number;
    gas: string;
    gasPrice: string;
    isError: string;
    input: string;
    contractAddress: string;
    cumulativeGasUsed: string;
    gasUsed: string;
    confirmations: string;
    methodId: string;
    functionName: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimal: number;
    usdPrice: number;
    type: string;
    tokenSymbol2: string;
}

const BnbTransactionSchema = new Schema({
    blockNumber: String,
    timeStamp: String,
    hash: String,
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
});

export default mongoose.model<Document & BnbTransaction>("BnbTransaction", BnbTransactionSchema);