import { Request, Response } from 'express';
import massiveApi from '../services/massiveApi';
import { getFromCache, setInCache } from '../utils/cache';

// ── Types ──────────────────────────────────────────────────────────────
interface IntradayBar {
    timestamp: number;  // Unix timestamp in seconds
    time: string;       // Human-readable time string
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number;
    transactions: number;
}

interface IntradayMover {
    ticker: string;
    name?: string;
    sector?: string;
    industry?: string;
    // Summary of movement in the time window
    startPrice: number;
    endPrice: number;
    highPrice: number;
    lowPrice: number;
    changePct: number;
    changeAbs: number;
    totalVolume: number;
    peakTime: string;       // Time of highest price
    troughTime: string;     // Time of lowest price
    direction: 'up' | 'down';
    // Intraday chart data points for sparkline
    chartData: { time: number; close: number; volume: number }[];
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
    });
}

function formatDateTimeET(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
    });
}

// ── Main handler: Get Intraday Movers ──────────────────────────────────
export const getIntradayMovers = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            date,          // e.g. "2026-02-25"
            fromHour,      // e.g. "18" (6 PM) - in ET
            toHour,        // e.g. "22" (10 PM) - in ET
            fromMinute,    // e.g. "0"
            toMinute,      // e.g. "0"
            direction,     // "up" | "down" | "both"
            minChange,     // minimum change % threshold, e.g. "2"
            timespan,      // "minute" | "hour" — default "hour"
            multiplier,    // aggregation multiplier, default "5" for 5-min bars
            limit,         // number of results, default "50"
            page,          // page number, default "1"
            sort,          // "changePct" | "volume" | "changeAbs"
            sortDir,       // "asc" | "desc"
        } = req.query;

        // Validate required params
        if (!date) {
            res.status(400).json({ success: false, error: 'date parameter is required (YYYY-MM-DD)' });
            return;
        }

        const dateStr = date as string;
        const fHour = fromHour !== undefined ? parseInt(fromHour as string) : 0;
        const tHour = toHour !== undefined ? parseInt(toHour as string) : 23;
        const fMinute = fromMinute !== undefined ? parseInt(fromMinute as string) : 0;
        const tMinute = toMinute !== undefined ? parseInt(toMinute as string) : 59;
        const dir = (direction as string) || 'both';
        const minChg = parseFloat(minChange as string) || 0;
        const ts = (timespan as string) || 'hour';
        const mult = parseInt(multiplier as string) || (ts === 'minute' ? 5 : 1);
        const lim = parseInt(limit as string) || 50;
        const pg = parseInt(page as string) || 1;
        const sortField = (sort as string) || 'changePct';
        const sortDirection = (sortDir as string) || 'desc';

        // Build cache key
        const cacheKey = `intraday_movers_${dateStr}_${fHour}:${fMinute}_${tHour}:${tMinute}_${dir}_${minChg}_${ts}_${mult}`;
        let movers: IntradayMover[] | undefined = getFromCache<IntradayMover[]>(cacheKey, false);

        if (!movers) {
            // Step 1: Get grouped daily data for the date to get all tickers
            const groupedCacheKey = `grouped_day_${dateStr}`;
            let groupedData: Record<string, any> | undefined = getFromCache(groupedCacheKey);

            if (!groupedData) {
                try {
                    const data = await massiveApi.getGroupedDaily(dateStr);
                    groupedData = {};
                    for (const t of data.results || []) {
                        (groupedData as Record<string, any>)[t.T] = {
                            open: t.o || 0,
                            high: t.h || 0,
                            low: t.l || 0,
                            close: t.c || 0,
                            volume: t.v || 0,
                            vwap: t.vw || 0,
                        };
                    }
                    setInCache(groupedCacheKey, groupedData, false, 7200);
                } catch (err: any) {
                    console.error('Failed to fetch grouped daily:', err.message);
                    res.status(500).json({ success: false, error: 'Failed to fetch market data for date' });
                    return;
                }
            }

            // Step 2: Filter tickers by broad criteria (price > $1, volume > 50k)
            const candidateTickers = Object.entries(groupedData as Record<string, any>)
                .filter(([_, bar]) => bar.close > 1 && bar.volume > 50000)
                .sort((a, b) => b[1].volume - a[1].volume)
                .slice(0, 500)  // Top 500 by volume as candidates
                .map(([ticker]) => ticker);

            // Step 3: Build the from/to timestamps in ET
            // Create date strings for intraday query
            // The API accepts YYYY-MM-DD or Unix ms timestamps
            const fromDate = dateStr;
            const toDate = dateStr;

            // Step 4: Fetch intraday bars for top tickers in batches
            const BATCH_SIZE = 10;
            movers = [];

            for (let i = 0; i < candidateTickers.length; i += BATCH_SIZE) {
                const batch = candidateTickers.slice(i, i + BATCH_SIZE);

                const batchPromises = batch.map(async (ticker) => {
                    const barCacheKey = `intraday_bars_${ticker}_${dateStr}_${ts}_${mult}`;
                    let bars: any[] | undefined = getFromCache(barCacheKey);

                    if (!bars) {
                        try {
                            const data = await massiveApi.getHistoricalData(
                                ticker,
                                mult,
                                ts,
                                fromDate,
                                toDate,
                                50000
                            );
                            bars = (data.results || []).map((bar: any) => ({
                                timestamp: bar.t,  // ms
                                open: bar.o,
                                high: bar.h,
                                low: bar.l,
                                close: bar.c,
                                volume: bar.v || 0,
                                vwap: bar.vw || 0,
                                transactions: bar.n || 0,
                            }));
                            setInCache(barCacheKey, bars, false, 3600);
                        } catch (err: any) {
                            if (err?.response?.status === 429) {
                                console.warn(`Rate limited fetching intraday for ${ticker}`);
                                return null;
                            }
                            return null;
                        }
                    }

                    if (!bars || bars.length === 0) return null;

                    // Step 5: Filter bars to the requested time window (in ET)
                    const filteredBars = bars.filter((bar: any) => {
                        const d = new Date(bar.timestamp);
                        // Convert to ET
                        const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York' });
                        const etDate = new Date(etStr);
                        const h = etDate.getHours();
                        const m = etDate.getMinutes();
                        const totalMinutes = h * 60 + m;
                        const fromTotal = fHour * 60 + fMinute;
                        const toTotal = tHour * 60 + tMinute;
                        return totalMinutes >= fromTotal && totalMinutes <= toTotal;
                    });

                    if (filteredBars.length < 2) return null;

                    // Step 6: Calculate movement in the time window
                    const startPrice = filteredBars[0].open;
                    const endPrice = filteredBars[filteredBars.length - 1].close;

                    let highPrice = -Infinity;
                    let lowPrice = Infinity;
                    let peakTime = '';
                    let troughTime = '';
                    let totalVolume = 0;

                    for (const bar of filteredBars) {
                        totalVolume += bar.volume;
                        if (bar.high > highPrice) {
                            highPrice = bar.high;
                            peakTime = formatTimestamp(bar.timestamp);
                        }
                        if (bar.low < lowPrice) {
                            lowPrice = bar.low;
                            troughTime = formatTimestamp(bar.timestamp);
                        }
                    }

                    const changeAbs = endPrice - startPrice;
                    const changePct = startPrice ? ((endPrice - startPrice) / startPrice) * 100 : 0;
                    const moveDirection: 'up' | 'down' = changePct >= 0 ? 'up' : 'down';

                    // Step 7: Apply direction filter
                    if (dir === 'up' && moveDirection !== 'up') return null;
                    if (dir === 'down' && moveDirection !== 'down') return null;

                    // Step 8: Apply min change filter
                    if (Math.abs(changePct) < minChg) return null;

                    // Build chart data
                    const chartData = filteredBars.map((bar: any) => ({
                        time: Math.floor(bar.timestamp / 1000),
                        close: bar.close,
                        volume: bar.volume,
                    }));

                    return {
                        ticker,
                        startPrice,
                        endPrice,
                        highPrice,
                        lowPrice,
                        changePct,
                        changeAbs,
                        totalVolume,
                        peakTime,
                        troughTime,
                        direction: moveDirection,
                        chartData,
                    } as IntradayMover;
                });

                const batchResults = await Promise.all(batchPromises);
                movers.push(...batchResults.filter((m): m is IntradayMover => m !== null));

                // Small delay between batches to avoid rate limiting
                if (i + BATCH_SIZE < candidateTickers.length) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            // Cache for 10 minutes
            setInCache(cacheKey, movers, false, 600);
        }

        // Sort results
        const sorted = [...movers].sort((a, b) => {
            let aVal: number, bVal: number;
            switch (sortField) {
                case 'volume':
                    aVal = a.totalVolume;
                    bVal = b.totalVolume;
                    break;
                case 'changeAbs':
                    aVal = Math.abs(a.changeAbs);
                    bVal = Math.abs(b.changeAbs);
                    break;
                case 'changePct':
                default:
                    aVal = Math.abs(a.changePct);
                    bVal = Math.abs(b.changePct);
                    break;
            }
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });

        // Paginate
        const total = sorted.length;
        const totalPages = Math.ceil(total / lim);
        const offset = (pg - 1) * lim;
        const pagedResults = sorted.slice(offset, offset + lim);

        res.json({
            success: true,
            data: pagedResults,
            meta: {
                total,
                page: pg,
                limit: lim,
                totalPages,
                sort: sortField,
                sortDir: sortDirection,
                date: dateStr,
                timeRange: `${String(fHour).padStart(2, '0')}:${String(fMinute).padStart(2, '0')} - ${String(tHour).padStart(2, '0')}:${String(tMinute).padStart(2, '0')} ET`,
            },
        });
    } catch (error: any) {
        console.error('Intraday movers error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Get Intraday Chart for a Specific Ticker ──────────────────────────
export const getIntradayChart = async (req: Request, res: Response): Promise<void> => {
    try {
        const tickerParam = req.params.ticker;
        const ticker = (Array.isArray(tickerParam) ? tickerParam[0] : tickerParam)?.toUpperCase();
        if (!ticker) {
            res.status(400).json({ success: false, error: 'ticker parameter is required' });
            return;
        }

        const {
            date,
            fromHour,
            toHour,
            fromMinute,
            toMinute,
            timespan,
            multiplier,
        } = req.query;

        const dateStr = (date as string) || new Date().toISOString().split('T')[0];
        const fHour = fromHour !== undefined ? parseInt(fromHour as string) : 0;
        const tHour = toHour !== undefined ? parseInt(toHour as string) : 23;
        const fMinute = fromMinute !== undefined ? parseInt(fromMinute as string) : 0;
        const tMinute = toMinute !== undefined ? parseInt(toMinute as string) : 59;
        const ts = (timespan as string) || 'minute';
        const mult = parseInt(multiplier as string) || 5;

        const cacheKey = `intraday_chart_${ticker}_${dateStr}_${ts}_${mult}_${fHour}:${fMinute}_${tHour}:${tMinute}`;
        const cached = getFromCache<any>(cacheKey);
        if (cached) {
            res.json({ success: true, data: cached, source: 'cache' });
            return;
        }

        let data: any;
        try {
            data = await massiveApi.getHistoricalData(
                ticker,
                mult,
                ts,
                dateStr,
                dateStr,
                50000
            );
        } catch (apiErr: any) {
            // If API doesn't support this timespan (free plan) or rate limited,
            // return empty bars gracefully instead of 500
            const status = apiErr?.response?.status;
            if (status === 403 || status === 429 || status === 400) {
                console.warn(`API returned ${status} for ${ticker} intraday chart (${ts}/${mult})`);
                const emptyResult = { ticker, date: dateStr, bars: [], summary: null };
                res.json({ success: true, data: emptyResult });
                return;
            }
            throw apiErr;
        }

        const allBars = (data.results || []).map((bar: any) => ({
            timestamp: bar.t,
            time: Math.floor(bar.t / 1000),
            timeLabel: formatDateTimeET(bar.t),
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v || 0,
            vwap: bar.vw || 0,
        }));

        // Filter to time window
        const filteredBars = allBars.filter((bar: any) => {
            const d = new Date(bar.timestamp);
            const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York' });
            const etDate = new Date(etStr);
            const h = etDate.getHours();
            const m = etDate.getMinutes();
            const totalMinutes = h * 60 + m;
            const fromTotal = fHour * 60 + fMinute;
            const toTotal = tHour * 60 + tMinute;
            return totalMinutes >= fromTotal && totalMinutes <= toTotal;
        });

        const result = {
            ticker,
            date: dateStr,
            bars: filteredBars,
            summary: filteredBars.length > 0 ? {
                open: filteredBars[0].open,
                close: filteredBars[filteredBars.length - 1].close,
                high: Math.max(...filteredBars.map((b: any) => b.high)),
                low: Math.min(...filteredBars.map((b: any) => b.low)),
                volume: filteredBars.reduce((sum: number, b: any) => sum + b.volume, 0),
                changePct: filteredBars[0].open
                    ? ((filteredBars[filteredBars.length - 1].close - filteredBars[0].open) / filteredBars[0].open) * 100
                    : 0,
            } : null,
        };

        setInCache(cacheKey, result, false, 3600);
        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Intraday chart error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
