import type { ExportFormat, HostContext, RuntimeConfig } from './types.js';
interface ValueTools {
    arr(value: unknown): unknown[];
    num(value: unknown, fallback: number): number;
    str(value: unknown, fallback: string): string;
    sanitizeArguments(value: unknown): Array<{
        claim: string;
        evidence: string;
        quote: string;
        source: string;
    }>;
    sanitizeCitations(value: unknown): Array<{
        claim: string;
        source: string;
        quote: string;
    }>;
    sanitizeConcepts(value: unknown): Array<{
        term: string;
        explanation: string;
    }>;
    sanitizeQuestions(value: unknown): string[];
    sanitizeQuotes(value: unknown): Array<{
        text: string;
        context: string;
        source: string;
    }>;
    defaultRateTokPerSec: number;
}
export declare function createExportTools(ctx: HostContext, tune: RuntimeConfig, tools: ValueTools): {
    attachExports: (value: unknown, exportFmt: ExportFormat) => Promise<void>;
    renderMarkdown: (value: unknown) => string;
};
export {};
