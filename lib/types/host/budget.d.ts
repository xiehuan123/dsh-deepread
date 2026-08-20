import type { DeepreadDepth, EstimateCall, EstimateResult, RuntimeConfig } from './types.js';
export declare function createBudgetRuntime(tune: RuntimeConfig, rates: {
    calibratedRate(): number | null;
    effectiveLatency(): number;
    effectiveRate(): number;
}): {
    buildEstimate: (text: string, depth: DeepreadDepth, ext?: {
        chars?: number;
        tokensPerChar?: number;
    }) => EstimateResult;
    estimateCall: (calls: number, inputTokens: number, outputTokens: number) => EstimateCall;
    estimateTokens: (text: string) => number;
};
