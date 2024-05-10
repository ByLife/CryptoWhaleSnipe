"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenPriceCache = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
class TokenPriceCache {
    static getPrice(contractAddress) {
        return __awaiter(this, void 0, void 0, function* () {
            const cached = TokenPriceCache.prices.get(contractAddress);
            const now = Date.now();
            if (cached && (now - cached.timestamp < TokenPriceCache.cacheDuration)) {
                return cached.price;
            }
            try {
                const response = yield axios_1.default.get(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`, {
                    timeout: 5000 // 5 seconds timeout
                });
                const price = response.data.market_data.current_price.usd || 0;
                TokenPriceCache.prices.set(contractAddress, {
                    price: price,
                    timestamp: Date.now()
                });
                console.log(TokenPriceCache.prices);
                return price;
            }
            catch (error) {
                logger_1.default.error(`Failed to fetch token price from CoinGecko: ${error}`);
                return 0;
            }
        });
    }
}
exports.TokenPriceCache = TokenPriceCache;
TokenPriceCache.prices = new Map();
TokenPriceCache.cacheDuration = 6000000; // Cache duration in milliseconds (100 minutes)
