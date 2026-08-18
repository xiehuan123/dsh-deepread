import type { CacheRecord, HostContext, RuntimeConfig } from './types.js';
export declare function createUrlCache(ctx: HostContext, tune: RuntimeConfig): {
    readCacheEntry: (url: string, ignoreTtl: boolean) => Promise<CacheRecord | null>;
    writeCacheEntry: (url: string, text: string) => Promise<void>;
};
