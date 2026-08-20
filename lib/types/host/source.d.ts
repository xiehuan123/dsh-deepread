import type { CacheRecord, DeepreadInput, HostContext, PdfStats, RuntimeConfig, SourceResult, WebService } from './types.js';
export declare function htmlToText(html: string): {
    title: string;
    text: string;
};
type ProgressCallback = (line: string) => void;
export interface SourceOptions {
    onProgress?: ProgressCallback | null | undefined;
    statsOnly?: boolean;
}
interface SourceRuntimeDependencies {
    bytesToLatin1(bytes: Uint8Array): string;
    ctx: HostContext;
    extractPdfStats(latin1: string): PdfStats;
    extractPdfText(latin1: string, onPage?: (info: {
        done: number;
        total: number;
    }) => void): string;
    readCacheEntry(url: string, ignoreTtl: boolean): Promise<CacheRecord | null>;
    tune: RuntimeConfig;
    web: WebService | undefined;
    writeCacheEntry(url: string, text: string): Promise<void>;
}
export declare function createSourceRuntime(deps: SourceRuntimeDependencies): {
    resolveForEstimate: (args: DeepreadInput) => Promise<SourceResult>;
    resolveSource: (args: DeepreadInput, opts?: SourceOptions) => Promise<SourceResult>;
};
export {};
