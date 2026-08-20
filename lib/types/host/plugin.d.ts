import type { Config as ConfigOptions } from './types.js';
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    timeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    chunkChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxParts: import("@deepseek-ai/schemastery").default<number, number>;
    maxInputChars: import("@deepseek-ai/schemastery").default<number, number>;
    cacheEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    cacheTtlHours: import("@deepseek-ai/schemastery").default<number, number>;
    estTokensPerSecond: import("@deepseek-ai/schemastery").default<number, number>;
    estLatencyPerCallMs: import("@deepseek-ai/schemastery").default<number, number>;
    backgroundMinChars: import("@deepseek-ai/schemastery").default<number, number>;
}>, Schemastery.ObjectT<{
    timeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    chunkChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxParts: import("@deepseek-ai/schemastery").default<number, number>;
    maxInputChars: import("@deepseek-ai/schemastery").default<number, number>;
    cacheEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    cacheTtlHours: import("@deepseek-ai/schemastery").default<number, number>;
    estTokensPerSecond: import("@deepseek-ai/schemastery").default<number, number>;
    estLatencyPerCallMs: import("@deepseek-ai/schemastery").default<number, number>;
    backgroundMinChars: import("@deepseek-ai/schemastery").default<number, number>;
}>>;
export declare const name = "deepread";
export declare const inject: string[];
export declare function apply(ctx: unknown, config?: ConfigOptions): void;
