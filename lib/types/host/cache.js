import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { isRecord } from './types.js';
const declareDomain = defineDomain;
const declareDomainTable = domainTable;
const cacheRecordSchema = z.object({
    url: z.string(),
    text: z.string(),
    fetchedAt: z.string(),
});
const cacheDomainSpec = declareDomain({
    name: 'deepread_url_cache',
    version: 1,
    tables: { articles: declareDomainTable(z.string(), cacheRecordSchema) },
});
export function createUrlCache(ctx, tune) {
    const ttlMs = tune.cacheTtlHours * 3600 * 1000;
    const maxEntries = 200;
    const memory = new Map();
    let domainHandle = null;
    let tablePromise = null;
    ctx.effect(() => () => { if (domainHandle !== null)
        void domainHandle.close(); });
    function getTable() {
        if (tablePromise === null) {
            tablePromise = (async () => {
                const storageDomain = ctx.get('storageDomain');
                if (storageDomain === undefined)
                    return null;
                try {
                    const domain = await storageDomain.open(cacheDomainSpec);
                    domainHandle = domain;
                    return domain.table('articles');
                }
                catch {
                    return null;
                }
            })();
        }
        return tablePromise;
    }
    function isStale(fetchedAt) {
        const fetchedAtMs = Date.parse(fetchedAt);
        return !Number.isFinite(fetchedAtMs) || Date.now() - fetchedAtMs >= ttlMs;
    }
    async function readCacheEntry(url, ignoreTtl) {
        const table = await getTable();
        if (table === null) {
            const record = memory.get(url);
            if (record === undefined)
                return null;
            return !ignoreTtl && isStale(record.fetchedAt) ? null : record;
        }
        const record = table.get(url);
        if (!isRecord(record)
            || typeof record.url !== 'string'
            || typeof record.text !== 'string'
            || typeof record.fetchedAt !== 'string')
            return null;
        if (!ignoreTtl && isStale(record.fetchedAt)) {
            try {
                await table.delete(url);
            }
            catch { /* expiry cleanup is best effort */ }
            return null;
        }
        return { url: record.url, text: record.text, fetchedAt: record.fetchedAt };
    }
    async function writeCacheEntry(url, text) {
        const record = { url, text, fetchedAt: new Date().toISOString() };
        const table = await getTable();
        if (table === null) {
            memory.set(url, record);
            return;
        }
        try {
            await table.put(url, record);
            const expired = [];
            const kept = [];
            for (const [key, value] of table.entries()) {
                if (typeof key !== 'string' || !isRecord(value) || typeof value.fetchedAt !== 'string')
                    continue;
                if (isStale(value.fetchedAt))
                    expired.push(key);
                else
                    kept.push({ key, fetchedAt: value.fetchedAt });
            }
            for (const key of expired) {
                try {
                    await table.delete(key);
                }
                catch { /* cleanup is best effort */ }
            }
            if (kept.length > maxEntries) {
                kept.sort((left, right) => left.fetchedAt < right.fetchedAt ? -1 : 1);
                for (const item of kept.slice(0, kept.length - maxEntries)) {
                    try {
                        await table.delete(item.key);
                    }
                    catch { /* cleanup is best effort */ }
                }
            }
        }
        catch {
            // Cache persistence never blocks the reading flow.
        }
    }
    return { readCacheEntry, writeCacheEntry };
}
