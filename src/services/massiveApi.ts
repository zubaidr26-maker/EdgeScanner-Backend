import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const MASSIVE_BASE_URL = 'https://api.massive.com';

class MassiveApiService {
    private client: AxiosInstance;
    private apiKey: string;

    constructor() {
        this.apiKey = process.env.MASSIVE_API_KEY || '';
        this.client = axios.create({
            baseURL: MASSIVE_BASE_URL,
            timeout: 30000,
            params: {
                apiKey: this.apiKey,
            },
        });
    }

    // Get all tickers with market data
    async getAllStocks(limit: number = 100, cursor?: string): Promise<any> {
        try {
            const params: any = {
                market: 'stocks',
                active: true,
                limit,
                order: 'asc',
                sort: 'ticker',
            };
            if (cursor) {
                params.cursor = cursor;
            }

            const response = await this.client.get('/v3/reference/tickers', { params });
            return response.data;
        } catch (error: any) {
            console.error('Error fetching all stocks:', error.message);
            throw error;
        }
    }

    // Get ticker details
    async getTickerDetails(ticker: string): Promise<any> {
        try {
            const response = await this.client.get(`/v3/reference/tickers/${ticker.toUpperCase()}`);
            return response.data;
        } catch (error: any) {
            console.error(`Error fetching details for ${ticker}:`, error.message);
            throw error;
        }
    }

    // Get previous day close (works on free plan)
    async getPreviousClose(ticker: string): Promise<any> {
        try {
            const response = await this.client.get(`/v2/aggs/ticker/${ticker.toUpperCase()}/prev`);
            return response.data;
        } catch (error: any) {
            console.error(`Error fetching previous close for ${ticker}:`, error.message);
            throw error;
        }
    }

    // Get historical aggregates (bars)
    async getHistoricalData(
        ticker: string,
        multiplier: number = 1,
        timespan: string = 'day',
        from: string,
        to: string,
        limit: number = 5000
    ): Promise<any> {
        try {
            const response = await this.client.get(
                `/v2/aggs/ticker/${ticker.toUpperCase()}/range/${multiplier}/${timespan}/${from}/${to}`,
                {
                    params: {
                        adjusted: true,
                        sort: 'asc',
                        limit,
                    },
                }
            );
            return response.data;
        } catch (error: any) {
            console.error(`Error fetching historical data for ${ticker}:`, error.message);
            throw error;
        }
    }

    // Get grouped daily (all tickers for a date) - works on free plan
    async getGroupedDaily(date: string): Promise<any> {
        try {
            const response = await this.client.get(`/v2/aggs/grouped/locale/us/market/stocks/${date}`, {
                params: {
                    adjusted: true,
                },
            });
            return response.data;
        } catch (error: any) {
            console.error('Error fetching grouped daily:', error.message);
            throw error;
        }
    }

    // Get market status
    async getMarketStatus(): Promise<any> {
        try {
            const response = await this.client.get('/v1/marketstatus/now');
            return response.data;
        } catch (error: any) {
            console.error('Error fetching market status:', error.message);
            throw error;
        }
    }

    // Search tickers
    async searchTickers(query: string, limit: number = 10): Promise<any> {
        try {
            const response = await this.client.get('/v3/reference/tickers', {
                params: {
                    search: query,
                    active: true,
                    limit,
                    market: 'stocks',
                },
            });
            return response.data;
        } catch (error: any) {
            console.error(`Error searching tickers for ${query}:`, error.message);
            throw error;
        }
    }
}

export const massiveApi = new MassiveApiService();
export default massiveApi;
