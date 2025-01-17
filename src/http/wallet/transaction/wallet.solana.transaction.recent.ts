import express from "express";
import SolTransaction from "../../../database/models/SolTransaction";
import SolanaWallet from "../../../database/models/SolWallet";
import AccessBearer from "../../../database/models/AccessBearer";


interface SolanaRecentTx {
  username: string;
  wallet: string;
  hash: string;
  timeStamp: number;
  type?: string;
  influencer: boolean;
  image: string | null;
  nickname: string | null;
  tokenSymbol: string;  
  tokenSymbol2: string;  
  usdPrice: number;
  contractAddress: string;
  contractAddress2: string;
}

export default {
  name: "/wallet/solana/transaction/recent",
  description: "Get recent Solana transactions",
  method: "GET",
  run: async (req: express.Request, res: express.Response) => {
    try {
      // 1) Security checks
      if (!req.token) {
        throw "Unauthorized access, missing 'token' in request header";
      }
      const validBearer = await AccessBearer.findOne({ token: req.token });
      if (!validBearer) {
        throw "Unauthorized access";
      }

      // blockTime is in seconds, so we do numeric comparison
      const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

      const transactions = await SolTransaction.find({
        blockTime: { $gte: oneDayAgo }
      }).lean();

      const results: SolanaRecentTx[] = [];

      for (const tx of transactions) {
        const wallet = await SolanaWallet.findOne({
          wallets: { $in: [tx.from, tx.to] }
        }).lean();

        if (!wallet) {
          continue; 
        }

        const totalUsdValue = tx.totalUsdValue || 0;

        const inSymbols = (tx.inTokens || []).map((t) => t.symbol).join(", ").replace(/\n/g, "");
        const outSymbols = (tx.outTokens || []).map((t) => t.symbol).join(", ").replace(/\n/g, "");

        results.push({
          username: wallet.username,
          wallet: wallet.wallets[0],
          hash: tx.signature,
          timeStamp: tx.blockTime,
          type: tx.type,
          influencer: wallet.influencer,
          image: wallet.image,
          nickname: wallet.nickname || null,
          contractAddress: tx.from || "",
          contractAddress2: tx.to || "",

          tokenSymbol2: inSymbols,
          tokenSymbol: outSymbols,
          usdPrice: totalUsdValue     
        });
      }

      res.status(200).json(results);
    } catch (error) {
      res.status(400).json({ error: error });
    }
  }
};
