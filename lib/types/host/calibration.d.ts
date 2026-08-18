import type { HostContext, RuntimeConfig } from './types.js';
export declare const DEFAULT_RATE_TOK_PER_SEC = 100;
export declare function createCalibrationRuntime(ctx: HostContext, tune: RuntimeConfig): {
    calibratedRate: () => number | null;
    effectiveLatency: () => number;
    effectiveRate: () => number;
    loadCalibration: () => Promise<void>;
    recordCalibration: (rateTokPerSec: number, latencyMs: number) => void;
};
