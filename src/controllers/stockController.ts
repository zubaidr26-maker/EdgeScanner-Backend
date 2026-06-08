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

// ── Related Companies ──────────────────────────────────────────────────
export const getStockPeers = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `peers_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getRelatedCompanies(ticker);
        const peers = data.results || [];
        setInCache(cacheKey, peers);
        res.json({ success: true, data: peers });
    } catch (error: any) {
        res.json({ success: true, data: [], error: 'Peers not available' });
    }
};

// ── Ticker News & Sentiment ───────────────────────────────────────────
export const getStockNews = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `news_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getTickerNews(ticker, 6);
        const news = (data.results || []).map((item: any) => ({
            id: item.id,
            title: item.title,
            author: item.author,
            published_utc: item.published_utc,
            article_url: item.article_url,
            image_url: item.image_url,
            description: item.description,
            // Parse sentiment if present
            sentiment: item.insights?.find((ins: any) => ins.ticker === ticker.toUpperCase())?.sentiment || 'neutral'
        }));

        setInCache(cacheKey, news);
        res.json({ success: true, data: news });
    } catch (error: any) {
        res.json({ success: true, data: [], error: 'News not available' });
    }
};

// ── Financials ────────────────────────────────────────────────────────
export const getStockFinancials = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `financials_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const data = await massiveApi.getFinancials(ticker);
        const financials = (data.results || []).map((item: any) => {
            const fd = item.financials;
            return {
                fiscal_period: item.fiscal_period,
                fiscal_year: item.fiscal_year,
                start_date: item.start_date,
                end_date: item.end_date,
                revenue: fd?.income_statement?.revenues?.value || 0,
                net_income: fd?.income_statement?.net_income_loss?.value || 0,
                operating_income: fd?.income_statement?.operating_income_loss?.value || 0,
                assets: fd?.balance_sheet?.assets?.value || 0,
                liabilities: fd?.balance_sheet?.liabilities?.value || 0,
                equity: fd?.balance_sheet?.equity?.value || 0,
                operating_cash_flow: fd?.cash_flow_statement?.net_cash_flow_from_operating_activities?.value || 0,
            };
        });

        setInCache(cacheKey, financials);
        res.json({ success: true, data: financials });
    } catch (error: any) {
        res.json({ success: true, data: [], error: 'Financials not available' });
    }
};

// ── Dividends & Stock Splits ──────────────────────────────────────────
export const getStockEvents = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `events_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const [divRes, splitRes] = await Promise.allSettled([
            massiveApi.getDividends(ticker),
            massiveApi.getStockSplits(ticker),
        ]);

        const dividends = divRes.status === 'fulfilled' ? (divRes.value.results || []).map((d: any) => ({
            cash_amount: d.cash_amount,
            declaration_date: d.declaration_date,
            ex_dividend_date: d.ex_dividend_date,
            pay_date: d.pay_date,
            frequency: d.frequency,
        })) : [];

        const splits = splitRes.status === 'fulfilled' ? (splitRes.value.results || []).map((s: any) => ({
            execution_date: s.execution_date,
            split_from: s.split_from,
            split_to: s.split_to,
        })) : [];

        const result = { dividends, splits };
        setInCache(cacheKey, result);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.json({ success: true, data: { dividends: [], splits: [] }, error: 'Events not available' });
    }
};

// ── Realtime Quote / Bid-Ask ──────────────────────────────────────────
export const getStockRealtime = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `realtime_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        const [tradeRes, quoteRes] = await Promise.allSettled([
            massiveApi.getLastTrade(ticker),
            massiveApi.getLastQuote(ticker),
        ]);

        const trade = tradeRes.status === 'fulfilled' ? tradeRes.value.results : null;
        const quote = quoteRes.status === 'fulfilled' ? quoteRes.value.results : null;

        const result = {
            price: trade?.p || null,
            size: trade?.s || null,
            timestamp: trade?.t ? Math.floor(trade.t / 1000) : null,
            bid: quote?.p || null,
            bidSize: quote?.s || null,
            ask: quote?.P || null,
            askSize: quote?.S || null,
        };

        // Cache briefly (10 seconds) for near realtime performance
        setInCache(cacheKey, result, true, 10);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.json({ success: true, data: null, error: 'Realtime quote not available on Starter plan' });
    }
};

// ── Technical Indicators (Local calculations on Starter plan) ─────────
export const getStockTechnicals = async (req: Request, res: Response): Promise<void> => {
    try {
        const ticker = Array.isArray(req.params.ticker) ? req.params.ticker[0] : req.params.ticker;
        const cacheKey = `technicals_calc_${ticker}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        // Fetch last 40 daily bars to calculate RSI(14) and SMA(20)
        const to = getTodayDate();
        const from = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]; // 60 days
        const rawBars = await massiveApi.getHistoricalData(ticker, 1, 'day', from, to);
        const bars = rawBars.results || [];

        if (bars.length < 20) {
            res.json({
                success: true,
                data: { sma20: null, rsi14: null, message: 'Insufficient data for indicators' }
            });
            return;
        }

        // 1. Calculate SMA 20
        const last20 = bars.slice(-20);
        const sma20 = last20.reduce((sum: number, bar: any) => sum + bar.c, 0) / 20;

        // 2. Calculate RSI 14
        let avgGain = 0;
        let avgLoss = 0;

        // Calculate initial change for first 14 periods
        for (let i = 1; i <= 14; i++) {
            const change = bars[i].c - bars[i - 1].c;
            if (change > 0) avgGain += change;
            else avgLoss += Math.abs(change);
        }
        avgGain /= 14;
        avgLoss /= 14;

        // Wilder's smoothing technique for remaining periods
        for (let i = 15; i < bars.length; i++) {
            const change = bars[i].c - bars[i - 1].c;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;
            avgGain = (avgGain * 13 + gain) / 14;
            avgLoss = (avgLoss * 13 + loss) / 14;
        }

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi14 = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

        const result = {
            sma20: parseFloat(sma20.toFixed(2)),
            rsi14: parseFloat(rsi14.toFixed(2)),
            price: bars[bars.length - 1].c,
        };

        setInCache(cacheKey, result);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.json({ success: true, data: { sma20: null, rsi14: null }, error: 'Technicals calculation error' });
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

