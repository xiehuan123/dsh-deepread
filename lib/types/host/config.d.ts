import Schema from '@deepseek-ai/schemastery';
import type { RuntimeConfig } from './types.js';
export declare const ConfigSchema: Schema<Schemastery.ObjectS<{
    timeoutMs: Schema<number, number>;
    chunkChars: Schema<number, number>;
    maxParts: Schema<number, number>;
    maxInputChars: Schema<number, number>;
    cacheEnabled: Schema<boolean, boolean>;
    cacheTtlHours: Schema<number, number>;
    estTokensPerSecond: Schema<number, number>;
    estLatencyPerCallMs: Schema<number, number>;
    backgroundMinChars: Schema<number, number>;
}>, Schemastery.ObjectT<{
    timeoutMs: Schema<number, number>;
    chunkChars: Schema<number, number>;
    maxParts: Schema<number, number>;
    maxInputChars: Schema<number, number>;
    cacheEnabled: Schema<boolean, boolean>;
    cacheTtlHours: Schema<number, number>;
    estTokensPerSecond: Schema<number, number>;
    estLatencyPerCallMs: Schema<number, number>;
    backgroundMinChars: Schema<number, number>;
}>>;
export declare function resolveConfig(input: unknown): RuntimeConfig;
