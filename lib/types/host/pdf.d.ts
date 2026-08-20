import type { PdfStats } from './types.js';
export interface PdfProgress {
    done: number;
    total: number;
}
interface ParsedPdfObject {
    dict: string;
    stream: string | null;
    filters: string[];
}
export declare function createPdfTools(estimateTokens: (text: string) => number): {
    bytesToLatin1: (bytes: Uint8Array) => string;
    collectPageNums: (latin1: string) => {
        pageNums: string[];
        getObject: (num: string | number | undefined) => ParsedPdfObject | null;
        resolveRef: (dict: string, key: string) => string | null;
        resolveMultiRef: (dict: string, key: string) => string[];
    };
    extractPdfStats: (latin1: string) => PdfStats;
    extractPdfText: (latin1: string, onPage?: (progress: PdfProgress) => void) => string;
};
export {};
