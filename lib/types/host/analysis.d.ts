import type { DeepreadDepth, DeepreadInput, ExportFormat, OutputLanguage } from './types.js';
export declare function parseDeepreadInput(value: unknown): DeepreadInput;
export declare function normalizeDepth(value: unknown): DeepreadDepth;
export declare function normalizeExportFormat(value: unknown): ExportFormat;
export declare function normalizeLanguage(value: unknown): OutputLanguage;
