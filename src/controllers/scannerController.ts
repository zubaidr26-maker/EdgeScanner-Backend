import { Request, Response } from 'express';
import massiveApi from '../services/massiveApi';
import { getFromCache, setInCache } from '../utils/cache';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Types ──────────────────────────────────────────────────────────────
interface DayBar {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number;
    transactions: number;
}

interface ComputedDay {
    gap: number;
    volume: number;
    range: number;
    highSpike: number;
    lowSpike: number;
    openPrice: number;
    closePrice: number;
    highPrice: number;
    lowPrice: number;
    returnPct: number;
    vwap: number;
    change: number;
    closeDirection: string;
    highGap: number;
    highFade: number;
}

interface ScanResult {
    ticker: string;
    gapDate?: string;  // YYYY-MM-DD of the gap day
    // Fundamental Data
    name?: string;
    sector?: string;
    industry?: string;
    country?: string;
    marketCap?: number;
    peRatio?: number;
    forwardPe?: number;
    dividendYield?: number;
    employees?: number;
    float?: number;
    sharesOutstanding?: number;
    beta?: number;
    eps?: number;
    // Price Action
    gapDay: ComputedDay;
    prevDay: ComputedDay;
    day2: ComputedDay;
    day3: ComputedDay;
}

// ── Helpers ────────────────────────────────────────────────────────────
function getLastBusinessDays(count: number, fromDate?: Date): string[] {
    const dates: string[] = [];
    const d = fromDate ? new Date(fromDate) : new Date();
    if (!fromDate) d.setDate(d.getDate() - 1);
    while (dates.length < count) {
        if (d.getDay() !== 0 && d.getDay() !== 6) {
            dates.push(d.toISOString().split('T')[0]);
        }
        d.setDate(d.getDate() - 1);
    }
    return dates;
}

// Get all business days between two dates (inclusive)
function getBusinessDaysBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    const d = new Date(end);
    while (d >= start) {
        if (d.getDay() !== 0 && d.getDay() !== 6) {
            dates.push(d.toISOString().split('T')[0]);
        }
        d.setDate(d.getDate() - 1);
    }
    return dates; // newest first
}

function getDateRangeFromPreset(preset: string): { from: string; to: string } {
    const now = new Date();
    const to = new Date(now);
    to.setDate(to.getDate() - 1); // yesterday
    // Skip weekends for 'to'
    while (to.getDay() === 0 || to.getDay() === 6) to.setDate(to.getDate() - 1);

    const from = new Date(to);
    switch (preset) {
        case 'today':
            return { from: now.toISOString().split('T')[0], to: now.toISOString().split('T')[0] };
        case 'yesterday':
            return { from: to.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
        case 'lastWeek':
            from.setDate(from.getDate() - 7);
            break;
        case 'last2Weeks':
            from.setDate(from.getDate() - 14);
            break;
        case 'lastMonth':
            from.setMonth(from.getMonth() - 1);
            break;
        case 'last3Months':
            from.setMonth(from.getMonth() - 3);
            break;
        default:
            // default: last 1 day (just yesterday)
            break;
    }
    return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
}

async function fetchGroupedDay(date: string): Promise<Record<string, DayBar>> {
    const cacheKey = `grouped_day_${date}`;
    const cached = getFromCache<Record<string, DayBar>>(cacheKey);
    if (cached) return cached;

    // Retry with backoff for rate limiting
    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const data = await massiveApi.getGroupedDaily(date);
            const map: Record<string, DayBar> = {};
            for (const t of data.results || []) {
                map[t.T] = {
                    open: t.o || 0,
                    high: t.h || 0,
                    low: t.l || 0,
                    close: t.c || 0,
                    volume: t.v || 0,
                    vwap: t.vw || 0,
                    transactions: t.n || 0,
                };
            }
            // Historical data doesn't change – cache for 2 hours
            setInCache(cacheKey, map, false, 7200);
            return map;
        } catch (err: any) {
            lastError = err;
            if (err?.response?.status === 429) {
                // Rate limited — wait and retry
                const delay = (attempt + 1) * 15000;
                console.log(`Rate limited on ${date}, retrying in ${delay / 1000}s...`);
                await new Promise((r) => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
    throw lastError;
}

function pct(a: number, b: number): number {
    return b !== 0 ? ((a - b) / b) * 100 : 0;
}

function computeDay(current: DayBar, prev: DayBar | null): ComputedDay {
    const prevClose = prev?.close ?? current.open;
    const rangeDenom = current.low || 1;
    const highLow = current.high - current.low || 1;

    return {
        gap: pct(current.open, prevClose),
        volume: current.volume,
        range: ((current.high - current.low) / rangeDenom) * 100,
        highSpike: current.open ? ((current.high - current.open) / current.open) * 100 : 0,
        lowSpike: current.open ? ((current.open - current.low) / current.open) * 100 : 0,
        openPrice: current.open,
        closePrice: current.close,
        highPrice: current.high,
        lowPrice: current.low,
        returnPct: current.open ? ((current.close - current.open) / current.open) * 100 : 0,
        vwap: current.vwap,
        change: pct(current.close, prevClose),
        closeDirection: current.close >= current.open ? 'green' : 'red',
        highGap: pct(current.high, prevClose),
        highFade: ((current.high - current.close) / highLow) * 100,
    };
}

// ── Filters definition ────────────────────────────────────────────────
const NUMERIC_FIELDS: (keyof ComputedDay)[] = [
    'gap', 'volume', 'range', 'highSpike', 'lowSpike',
    'openPrice', 'closePrice', 'highPrice', 'lowPrice',
    'returnPct', 'vwap', 'change', 'highGap', 'highFade',
];

const DAY_PREFIXES = ['gd', 'pd', 'd2', 'd3'] as const;
type DayPrefix = typeof DAY_PREFIXES[number];
const DAY_KEYS: Record<DayPrefix, keyof ScanResult> = {
    gd: 'gapDay',
    pd: 'prevDay',
    d2: 'day2',
    d3: 'day3',
};

interface RangeFilter {
    min?: number;
    max?: number;
}

type ParsedFilters = Record<string, RangeFilter>;

function parseFilters(query: Record<string, any>): {
    numeric: ParsedFilters;
    directions: Record<string, string>;
    sort: string;
    sortDir: string;
} {
    const numeric: ParsedFilters = {};
    const directions: Record<string, string> = {};
    const sort = (query.sort as string) || 'gd_volume';
    const sortDir = (query.sortDir as string) || 'desc';

    for (const prefix of DAY_PREFIXES) {
        for (const field of NUMERIC_FIELDS) {
            const minKey = `${prefix}_${field}Min`;
            const maxKey = `${prefix}_${field}Max`;
            const filterKey = `${prefix}_${field}`;

            if (query[minKey] || query[maxKey]) {
                numeric[filterKey] = {
                    min: query[minKey] ? parseFloat(query[minKey] as string) : undefined,
                    max: query[maxKey] ? parseFloat(query[maxKey] as string) : undefined,
                };
            }
        }

        // Close direction filter
        const dirKey = `${prefix}_closeDirection`;
        if (query[dirKey]) {
            directions[dirKey] = query[dirKey] as string;
        }
    }

    return { numeric, directions, sort, sortDir };
}

function applyFilters(results: ScanResult[], numeric: ParsedFilters, directions: Record<string, string>): ScanResult[] {
    return results.filter((item) => {
        // Check numeric filters
        for (const [filterKey, range] of Object.entries(numeric)) {
            const [prefix, field] = filterKey.split('_') as [DayPrefix, keyof ComputedDay];
            const dayKey = DAY_KEYS[prefix];
            if (!dayKey) continue;
            const dayData = item[dayKey] as ComputedDay;
            if (!dayData) continue;
            const value = dayData[field] as number;

            if (range.min !== undefined && value < range.min) return false;
            if (range.max !== undefined && value > range.max) return false;
        }

        // Check direction filters
        for (const [filterKey, dirValue] of Object.entries(directions)) {
            const [prefix] = filterKey.split('_') as [DayPrefix];
            const dayKey = DAY_KEYS[prefix];
            if (!dayKey) continue;
            const dayData = item[dayKey] as ComputedDay;
            if (!dayData) continue;
            if (dayData.closeDirection !== dirValue) return false;
        }

        return true;
    });
}

function sortResults(results: ScanResult[], sort: string, sortDir: string): ScanResult[] {
    const parts = sort.split('_');
    const prefix = parts[0] as DayPrefix;
    const field = parts.slice(1).join('_') as keyof ComputedDay;
    const dayKey = DAY_KEYS[prefix];

    if (!dayKey) return results;

    return [...results].sort((a, b) => {
        const aDay = a[dayKey] as ComputedDay;
        const bDay = b[dayKey] as ComputedDay;
        const aVal = (aDay?.[field] as number) || 0;
        const bVal = (bDay?.[field] as number) || 0;
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

// ── Main handler ───────────────────────────────────────────────────────
async function enrichWithFundamentals(results: ScanResult[]): Promise<ScanResult[]> {
    const BATCH_SIZE = 10;
    const enriched: ScanResult[] = [];
    const STALE_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE);

        // 1. Fetch from DB
        const tickers = batch.map(r => r.ticker);
        let dbProfiles: any[] = [];
        try {
            dbProfiles = await prisma.stockProfile.findMany({
                where: { ticker: { in: tickers } }
            });
        } catch (e) {
            console.error('DB Profile fetch failed:', e);
            // Fallback to empty if DB fails
        }

        const profileMap = new Map(dbProfiles.map((p: any) => [p.ticker, p]));

        const batchPromises = batch.map(async (res) => {
            const profile = profileMap.get(res.ticker);
            let details: Partial<ScanResult> = {};
            let isStale = false;

            // Use DB profile if available
            if (profile) {
                details = {
                    name: profile.name || undefined,
                    sector: profile.sector || undefined,
                    industry: profile.industry || undefined,
                    country: profile.country || undefined,
                    marketCap: profile.marketCap || undefined,
                    employees: profile.employees || undefined,
                    sharesOutstanding: profile.sharesOutstanding || undefined,
                };

                const updatedAt = new Date(profile.updatedAt).getTime();
                if (Date.now() - updatedAt > STALE_THRESHOLD) {
                    isStale = true;
                }
            }

            // If missing core data OR stale, try API fetch (with rate limit protection)
            // But if we have stale data, we only fetch if we don't hit rate limits
            if (!details.name || !details.sector || isStale) {
                const cacheKey = `fund_api_${res.ticker}`;
                const rateLimitHit = getFromCache('rate_limit_hit', true);

                // If it's just stale (not missing), and we hit rate limit, skip update to save calls
                // If it's missing data, we try harder (unless hard limited)
                const skipUpdate = isStale && rateLimitHit;

                if (!getFromCache(cacheKey) && !rateLimitHit && !skipUpdate) {
                    try {
                        const rawData = await massiveApi.getTickerDetails(res.ticker);
                        const r = rawData.results || {};

                        const newDetails = {
                            name: r.name,
                            sector: r.sic_description,
                            industry: r.sic_description,
                            country: r.locale,
                            marketCap: r.market_cap,
                            employees: r.total_employees,
                            sharesOutstanding: r.weighted_shares_outstanding,
                        };

                        // Merge with existing (prefer new)
                        details = { ...details, ...newDetails };

                        // Save to DB (Update updatedAt timestamp)
                        try {
                            await prisma.stockProfile.upsert({
                                where: { ticker: res.ticker },
                                update: {
                                    ...newDetails,
                                    updatedAt: new Date() // Explicitly update time
                                },
                                create: {
                                    ticker: res.ticker,
                                    ...newDetails
                                }
                            });
                        } catch (e) { /* ignore DB errors */ }

                        setInCache(cacheKey, true, false, 300);
                    } catch (e: any) {
                        if (e.response?.status === 429) {
                            console.warn(`Rate limit hit updating ${res.ticker}`);
                            setInCache('rate_limit_hit', true, true, 60);
                        }
                        setInCache(cacheKey, true, false, 60);
                    }
                }
            }

            return { ...res, ...details };
        });

        enriched.push(...(await Promise.all(batchPromises)));

        if (i + BATCH_SIZE < results.length) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between batches
        }
    }
    return enriched;
}

export const scanStocks = async (req: Request, res: Response): Promise<void> => {
    try {
        const { numeric, directions, sort, sortDir } = parseFilters(req.query as Record<string, any>);
        const limit = parseInt(req.query.limit as string) || 50;
        const page = parseInt(req.query.page as string) || 1;

        // ── Date parameters ─────────────────────────────────────────
        const gapDate = req.query.gapDate as string | undefined;      // specific date: "2026-02-25"
        const dateFrom = req.query.dateFrom as string | undefined;    // range start
        const dateTo = req.query.dateTo as string | undefined;        // range end
        const dateRange = req.query.dateRange as string | undefined;  // preset: "lastWeek", "lastMonth"

        // Determine which gap days to scan
        let gapDays: string[];
        if (gapDate) {
            // Single specific date
            gapDays = [gapDate];
        } else if (dateFrom && dateTo) {
            // Custom range
            gapDays = getBusinessDaysBetween(dateFrom, dateTo);
        } else if (dateRange) {
            // Preset range
            const { from, to } = getDateRangeFromPreset(dateRange);
            gapDays = getBusinessDaysBetween(from, to);
        } else {
            // Default: just yesterday (most recent business day)
            gapDays = getLastBusinessDays(1);
        }

        // For each gap day, we need 4 additional preceding business days
        // Collect all unique dates needed
        const allDatesNeeded = new Set<string>();
        const gapDayContextMap: Record<string, string[]> = {};
        for (const gd of gapDays) {
            const contextDays = getLastBusinessDays(5, new Date(gd + 'T12:00:00'));
            // contextDays[0] = gapDay itself (or the day before if gd is today)
            // We need: gapDay + 4 preceding days
            const fullDays = [gd, ...contextDays.filter(d => d !== gd).slice(0, 4)];
            gapDayContextMap[gd] = fullDays;
            fullDays.forEach(d => allDatesNeeded.add(d));
        }

        const cacheKey = `scanner_${Array.from(allDatesNeeded).sort().join('_')}`;
        let scanData: ScanResult[] | undefined = getFromCache<ScanResult[]>(cacheKey, true);

        if (!scanData) {
            // Fetch all unique dates
            const dateList = Array.from(allDatesNeeded).sort();
            const dateFetchMap: Record<string, Record<string, DayBar>> = {};
            for (const d of dateList) {
                dateFetchMap[d] = await fetchGroupedDay(d);
                await new Promise((r) => setTimeout(r, 250));
            }

            scanData = [];

            for (const gd of gapDays) {
                const days = gapDayContextMap[gd];
                const d0map = dateFetchMap[days[0]] || {};
                const d1map = dateFetchMap[days[1]] || {};
                const d2map = dateFetchMap[days[2]] || {};
                const d3map = dateFetchMap[days[3]] || {};
                const d4map = dateFetchMap[days[4]] || {};

                const gapDayTickers = Object.keys(d0map);
                for (const ticker of gapDayTickers) {
                    const bar0 = d0map[ticker];
                    const bar1 = d1map[ticker];
                    const bar2 = d2map[ticker];
                    const bar3 = d3map[ticker];
                    const bar4 = d4map[ticker];

                    if (!bar0 || bar0.close <= 0) continue;

                    scanData.push({
                        ticker,
                        gapDate: gd,
                        gapDay: computeDay(bar0, bar1 || null),
                        prevDay: bar1 ? computeDay(bar1, bar2 || null) : computeDay(bar0, null),
                        day2: bar2 ? computeDay(bar2, bar3 || null) : computeDay(bar0, null),
                        day3: bar3 ? computeDay(bar3, bar4 || null) : computeDay(bar0, null),
                    });
                }
            }

            setInCache(cacheKey, scanData, true, 120);
        }

        // Apply filters
        let filtered = applyFilters(scanData, numeric, directions);

        // Sort
        filtered = sortResults(filtered, sort, sortDir);

        // Paginate
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginatedResults = filtered.slice(offset, offset + limit);

        // Enrich with fundamental data
        const enrichedResults = await enrichWithFundamentals(paginatedResults);

        res.json({
            success: true,
            data: enrichedResults,
            meta: {
                total,
                page,
                limit,
                totalPages,
                sort,
                sortDir,
                gapDays: gapDays,
                dateRange: dateRange || (gapDate ? 'single' : (dateFrom && dateTo ? 'custom' : 'default')),
            },
        });
    } catch (error: any) {
        console.error('Scanner error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
