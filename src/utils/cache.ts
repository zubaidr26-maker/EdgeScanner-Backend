import NodeCache from 'node-cache';

// Cache with 5 minute TTL for stock data, 1 minute for frequently changing data
const stockCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const frequentCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

export const getFromCache = <T>(key: string, frequent: boolean = false): T | undefined => {
    const cache = frequent ? frequentCache : stockCache;
    return cache.get<T>(key);
};

export const setInCache = <T>(key: string, value: T, frequent: boolean = false, ttl?: number): boolean => {
    const cache = frequent ? frequentCache : stockCache;
    if (ttl) {
        return cache.set(key, value, ttl);
    }
    return cache.set(key, value);
};

export const deleteFromCache = (key: string, frequent: boolean = false): number => {
    const cache = frequent ? frequentCache : stockCache;
    return cache.del(key);
};

export const flushCache = (): void => {
    stockCache.flushAll();
    frequentCache.flushAll();
};

export default { getFromCache, setInCache, deleteFromCache, flushCache };
