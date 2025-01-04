// src/autoload/tokenCache.autoload.ts

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
            // Try CoinGecko first
            const price = await this.getPriceFromCoinGecko(contractAddress);
            
            // If CoinGecko fails, try DEX data
            if (!price) {
                const dexPrice = await this.getPriceFromDex(contractAddress);
                if (dexPrice) {
                    TokenPriceCache.prices.set(contractAddress, {
                        price: dexPrice,
                        timestamp: Date.now()
                    });
                    return dexPrice;
                }
            }

            TokenPriceCache.prices.set(contractAddress, {
                price: price || 0,
                timestamp: Date.now()
            });

            return price || 0;
        } catch (error) {
            Logger.error(`Failed to fetch token price: ${error}`);
            return 0;
        }
    }

    private static async getPriceFromDex(contractAddress: string) {
        try {
            const response = await axios.post('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2', {
                query: `{
                    token(id: "${contractAddress.toLowerCase()}") {
                        derivedETH
                    }
                    bundle(id: "1") {
                        ethPrice
                    }
                }`
            });

            if (response.data?.data?.token?.derivedETH && response.data?.data?.bundle?.ethPrice) {
                const derivedETH = parseFloat(response.data.data.token.derivedETH);
                const ethPrice = parseFloat(response.data.data.bundle.ethPrice);
                return derivedETH * ethPrice;
            }

            return 0;
        } catch (error) {
            Logger.error(`Failed to fetch DEX price: ${error}`);
            return 0;
        }
    }

    private static async getPriceFromCoinGecko(contractAddress: string) {
        try {
            const response = await axios.get(
                `https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`,
                { timeout: 5000 }
            );
            return response.data.market_data?.current_price?.usd || 0;
        } catch (error) {
            return 0;
        }
    }
}


