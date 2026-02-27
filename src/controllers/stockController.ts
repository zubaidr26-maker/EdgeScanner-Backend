import { Request, Response } from 'express';
import massiveApi from '../services/massiveApi';
import { getFromCache, setInCache } from '../utils/cache';

// Helper: get previous business day
function getPreviousBusinessDay(): string {
    const now = new Date();
    let d = new Date(now);
    // Go back 1 day, skip weekends
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
    }
    return d.toISOString().split('T')[0];
}

// Helper: get the day before a given date string
function getDayBefore(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
    }
    return d.toISOString().split('T')[0];
}

// Fetch grouped daily data (cached)
async function fetchGroupedDaily(): Promise<any[]> {
    const cacheKey = 'grouped_daily';
    const cached = getFromCache<any[]>(cacheKey, true);
    if (cached) return cached;

    // Try today first, then previous business day
    let date = getPreviousBusinessDay();
    let data = await massiveApi.getGroupedDaily(date);
    let results = data.results || [];

    // If no results (e.g., holiday), try the day before
    if (results.length === 0) {
        date = getDayBefore(date);
        data = await massiveApi.getGroupedDaily(date);
        results = data.results || [];
    }

    // Process and add change calculation
    const processed = results.map((t: any) => ({
        ticker: t.T,
        open: t.o || 0,
        high: t.h || 0,
        low: t.l || 0,
        close: t.c || 0,
        volume: t.v || 0,
        vwap: t.vw || 0,
        price: t.c || 0,
        change: t.o ? (t.c - t.o) : 0,
        changePercent: t.o ? ((t.c - t.o) / t.o * 100) : 0,
        transactions: t.n || 0,
    }));

    setInCache(cacheKey, processed, true);
    return processed;
}

export const getAllStocks = async (req: Request, res: Response): Promise<void> => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const cacheKey = `stocks_all_${limit}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getAllStocks(limit);
        setInCache(cacheKey, data.results || []);
        res.json({ success: true, data: data.results || [] });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getStockByTicker = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `stock_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const [detailsRes, prevCloseRes] = await Promise.allSettled([
            massiveApi.getTickerDetails(ticker),
            massiveApi.getPreviousClose(ticker),
        ]);

        const details = detailsRes.status === 'fulfilled' ? (detailsRes as PromiseFulfilledResult<any>).value?.results : null;
        const prevData = prevCloseRes.status === 'fulfilled' ? (prevCloseRes as PromiseFulfilledResult<any>).value?.results?.[0] : null;

        const stockData = {
            ticker: ticker.toUpperCase(),
            name: details?.name || ticker,
            description: details?.description || '',
            marketCap: details?.market_cap || 0,
            shareClassSharesOutstanding: details?.share_class_shares_outstanding || 0,
            weightedSharesOutstanding: details?.weighted_shares_outstanding || 0,
            homepageUrl: details?.homepage_url || '',
            listDate: details?.list_date || '',
            locale: details?.locale || 'us',
            sic_description: details?.sic_description || '',
            branding: details?.branding || {},
            // Aggregated data from previous close
            price: prevData?.c || 0,
            open: prevData?.o || 0,
            high: prevData?.h || 0,
            low: prevData?.l || 0,
            close: prevData?.c || 0,
            volume: prevData?.v || 0,
            vwap: prevData?.vw || 0,
            previousClose: prevData?.o || 0,
            change: prevData ? (prevData.c - prevData.o) : 0,
            changePercent: prevData?.o ? ((prevData.c - prevData.o) / prevData.o * 100) : 0,
            updated: Date.now(),
        };

        setInCache(cacheKey, stockData);
        res.json({ success: true, data: stockData });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getGainers = async (_req: Request, res: Response): Promise<void> => {
    try {
        const cacheKey = 'stocks_gainers';
        const cached = getFromCache<any>(cacheKey, true);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const allStocks = await fetchGroupedDaily();
        // Filter for positive change, sort by change% descending
        const gainers = allStocks
            .filter((s) => s.changePercent > 0 && s.volume > 100000 && s.price > 1)
            .sort((a, b) => b.changePercent - a.changePercent)
            .slice(0, 20);

        setInCache(cacheKey, gainers, true);
        res.json({ success: true, data: gainers });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getLosers = async (_req: Request, res: Response): Promise<void> => {
    try {
        const cacheKey = 'stocks_losers';
        const cached = getFromCache<any>(cacheKey, true);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const allStocks = await fetchGroupedDaily();
        // Filter for negative change, sort by change% ascending (most negative first)
        const losers = allStocks
            .filter((s) => s.changePercent < 0 && s.volume > 100000 && s.price > 1)
            .sort((a, b) => a.changePercent - b.changePercent)
            .slice(0, 20);

        setInCache(cacheKey, losers, true);
        res.json({ success: true, data: losers });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getMostActive = async (_req: Request, res: Response): Promise<void> => {
    try {
        const cacheKey = 'stocks_active';
        const cached = getFromCache<any>(cacheKey, true);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const allStocks = await fetchGroupedDaily();
        // Sort by volume descending
        const active = allStocks
            .filter((s) => s.price > 1)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 20);

        setInCache(cacheKey, active, true);
        res.json({ success: true, data: active });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getStockHistory = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const timespan = (req.query.timespan as string) || 'day';
        const multiplier = parseInt(req.query.multiplier as string) || 1;
        const from = (req.query.from as string) || getDefaultFromDate();
        const to = (req.query.to as string) || getTodayDate();

        const cacheKey = `history_${ticker}_${timespan}_${multiplier}_${from}_${to}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getHistoricalData(ticker, multiplier, timespan, from, to);
        const results = (data.results || []).map((bar: any) => ({
            time: Math.floor(bar.t / 1000),
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
        }));

        setInCache(cacheKey, results);
        res.json({ success: true, data: results });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const searchStocks = async (req: Request, res: Response): Promise<void> => {
    try {
        const queryParam = req.query.q;
        const query = (Array.isArray(queryParam) ? queryParam[0] : queryParam as string) || '';
        if (!query) {
            res.json({ success: true, data: [] });
            return;
        }

        const cacheKey = `search_${query}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.searchTickers(String(query));
        const results = (data.results || []).map((t: any) => ({
            ticker: t.ticker,
            name: t.name,
            market: t.market,
            type: t.type,
            locale: t.locale,
        }));

        setInCache(cacheKey, results);
        res.json({ success: true, data: results });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getMarketStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        const cacheKey = 'market_status';
        const cached = getFromCache<any>(cacheKey, true);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getMarketStatus();
        setInCache(cacheKey, data, true);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Helper functions
function getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
}

function getDefaultFromDate(): string {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().split('T')[0];
}
