import mongoose, { Document, Schema } from "mongoose";

export interface SolanaTransaction {
    signature: string;
    blockTime: number;
    slot: number;
    result: {
        from: string;
        to: string;
        amount: number;
        tokenName: string;
        tokenSymbol: string;
    };
}

const SolanaTransactionSchema = new Schema({
    signature: String,
    blockTime: Number,
    slot: Number,
    result: {
        from: String,
        to: String,
        amount: Number,
        tokenName: String,
        tokenSymbol: String
    }
});

export default mongoose.model<Document & SolanaTransaction>("SolanaTransaction", SolanaTransactionSchema);
