// src/http/wallet/transaction/wallet.eth.transaction.recent.ts

import express from "express";
import EtherTransaction from '../../../database/models/EtherTransaction';
import EthereumWallet from '../../../database/models/EtherWallet';
import AccessBearer from "../../../database/models/AccessBearer";

export default {
    name: "/wallet/transaction/recent",
    description: "Get recent transactions",
    method: "GET",
    run: async (req: express.Request, res: express.Response) => {
        try {
            if(!req.token) throw "Unauthorized access, missing 'token' in request header"
            if(!await AccessBearer.findOne({token: req.token})) throw "Unauthorized access"

            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const transactions = await EtherTransaction.find({
                timestamp: {
                    $gte: oneDayAgo
                }
            }).lean();

            const results = [];
            for (const tx of transactions) {
                // Find wallet that matches either from or to address
                const wallet = await EthereumWallet.findOne({
                    wallets: { $in: [tx.from, tx.to] }
                }).lean();

                if (!wallet) continue;

                // Skip transactions without valid addresses
                if (!tx.from && !tx.to) continue;
                
                // Ensure both addresses are strings before checking
                const fromAddress = tx.from || '';
                const toAddress = tx.to || '';
                const walletAddress = wallet.wallets.includes(fromAddress) ? fromAddress : toAddress;
                
                // Skip if we couldn't determine a valid wallet address
                if (!walletAddress) continue;

                // Determine token symbols based on transaction type
                let primaryTokenSymbol = '';
                let secondaryTokenSymbol = '';
                let value = 0;
                let usdPrice = 0;

                if (tx.type === 'swap') {
                    // For swaps, use outTokens and inTokens
                    primaryTokenSymbol = tx.outTokens?.[0]?.symbol || '';
                    secondaryTokenSymbol = tx.finalToken?.symbol || tx.inTokens?.[tx.inTokens.length - 1]?.symbol || '';
                    value = tx.outTokens?.[0]?.amount || 0;
                    usdPrice = tx.totalUsdValue || 0;
                } else {
                    // For other transactions, use the single token info
                    primaryTokenSymbol = tx.tokenSymbol || '';
                    secondaryTokenSymbol = tx.tokenSymbol2 || '';
                    value = tx.value || 0;
                    usdPrice = tx.usdPrice || 0;
                }

                results.push({
                    username: wallet.username,
                    wallet: walletAddress,
                    tokenSymbol: primaryTokenSymbol,
                    hash: tx.hash,
                    gasUsed: tx.gasUsed,
                    timeStamp: tx.timestamp ? Math.floor(tx.timestamp.getTime() / 1000).toString() : '',
                    usdPrice: usdPrice,
                    value: value,
                    type: tx.type,
                    tokenSymbol2: secondaryTokenSymbol,
                    influencer: wallet.influencer,
                    image: wallet.image,
                    nickname: wallet.nickname,
                    summary: tx.summary,
                    methodId: tx.methodId,
                    functionName: tx.functionName,
                    marketCap: tx.marketCap,
                    singleTransaction: tx.singleTransaction,
                    singleTokenUsdValue: tx.singleTokenUsdValue,
                    singleTokenMarketCap: tx.singleTokenMarketCap,
                    contractAddress: tx.contractAddress,
                });
            }

            res.status(200).json(results);
        } catch (error) {
            res.status(400).json({ error: error });
        }
    }
}