import Schema from '@deepseek-ai/schemastery';
import { isRecord } from './types.js';
export const ConfigSchema = Schema.object({
    timeoutMs: Schema.number().default(900000),
    chunkChars: Schema.number().default(6000),
    maxParts: Schema.number().default(20),
    maxInputChars: Schema.number().default(400000),
    cacheEnabled: Schema.boolean().default(true),
    cacheTtlHours: Schema.number().default(168),
    estTokensPerSecond: Schema.number().default(0),
    estLatencyPerCallMs: Schema.number().default(0),
    backgroundMinChars: Schema.number().default(9000),
});
function nonNegativeNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function positiveNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
export function resolveConfig(input) {
    const config = isRecord(input) ? input : {};
    return {
        timeoutMs: positiveNumber(config.timeoutMs, 900000),
        chunkChars: positiveNumber(config.chunkChars, 6000),
        maxParts: positiveNumber(config.maxParts, 20),
        maxInputChars: positiveNumber(config.maxInputChars, 400000),
        cacheEnabled: typeof config.cacheEnabled === 'boolean' ? config.cacheEnabled : true,
        cacheTtlHours: nonNegativeNumber(config.cacheTtlHours, 168),
        estTokensPerSecond: nonNegativeNumber(config.estTokensPerSecond, 0),
        estLatencyPerCallMs: nonNegativeNumber(config.estLatencyPerCallMs, 0),
        backgroundMinChars: positiveNumber(config.backgroundMinChars, 9000),
    };
}
