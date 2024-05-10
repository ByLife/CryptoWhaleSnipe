import axios from 'axios';
import Logger from '../logger'; 

export class TokenPriceCache {
    static prices = new Map();
    static cacheDuration = 6000000; // Cache duration in milliseconds (100 minutes)

    public static async getPrice(contractAddress: string) {
        const cached = TokenPriceCache.prices.get(contractAddress);
        const now = Date.now();

        if (cached && (now - cached.timestamp < TokenPriceCache.cacheDuration)) {
            return cached.price;
        }

        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`, {
                timeout: 5000  // 5 seconds timeout
            });
            const price = response.data.market_data.current_price.usd || 0;

            TokenPriceCache.prices.set(contractAddress, {
                price: price,
                timestamp: Date.now()
            });

            console.log(TokenPriceCache.prices);

            return price;
        } catch (error) {
            Logger.error(`Failed to fetch token price from CoinGecko: ${error}`);
            return 0; 
        }
    }
}


