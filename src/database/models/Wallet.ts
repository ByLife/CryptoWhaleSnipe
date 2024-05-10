import mongoose, {Document, Schema} from "mongoose";

export interface EthereumWallet {
    created_at: Date; 
    balance: number; 
    wallets: string[]; 
    username: string; 
    orderType: string;
}

export interface EthereumWalletDocument extends EthereumWallet, Document {}

const EthereumWalletSchema = new Schema({
    created_at: {
        type: Date,
        default: Date.now
    },
    balance: {
        type: Number,
        required: false,
        default: null
    },
    wallets: {
        type: [String],
        required: true
    },
    username: {
        type: String,
        required: true
    },

    orderType: {
        type: String,
        required: false,
        default: "buy"
    }

});

export default mongoose.model<EthereumWalletDocument>("EthereumWallet", EthereumWalletSchema);