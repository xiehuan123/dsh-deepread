export interface Config {
    timeoutMs?: number;
    chunkChars?: number;
    maxParts?: number;
    maxInputChars?: number;
    cacheEnabled?: boolean;
    cacheTtlHours?: number;
    estTokensPerSecond?: number;
    estLatencyPerCallMs?: number;
    backgroundMinChars?: number;
}
export declare const name: 'deepread';
export declare const Config: object;
export declare const inject: readonly string[];
export declare function apply(ctx: object, config?: Config): void;
