import { isRecord } from './types.js';
function optionalString(value) {
    return typeof value === 'string' ? value : undefined;
}
function parseBatchItem(value) {
    if (!isRecord(value))
        return null;
    const item = {};
    for (const key of ['title', 'url', 'path', 'text', 'focus']) {
        const field = optionalString(value[key]);
        if (field !== undefined)
            item[key] = field;
    }
    return item;
}
export function parseDeepreadInput(value) {
    if (!isRecord(value))
        return {};
    const input = {};
    for (const key of ['url', 'text', 'path', 'focus']) {
        const field = optionalString(value[key]);
        if (field !== undefined)
            input[key] = field;
    }
    if (typeof value.refresh === 'boolean')
        input.refresh = value.refresh;
    if (typeof value.estimate === 'boolean')
        input.estimate = value.estimate;
    input.depth = normalizeDepth(value.depth);
    input.export = normalizeExportFormat(value.export);
    input.language = normalizeLanguage(value.language);
    if (Array.isArray(value.batch))
        input.batch = value.batch.map(parseBatchItem).filter((item) => item !== null);
    return input;
}
export function normalizeDepth(value) {
    return value === 'quick' || value === 'map' || value === 'feynman' || value === 'book' ? value : 'deep';
}
export function normalizeExportFormat(value) {
    return value === 'md' || value === 'mm' || value === 'html' || value === 'all' ? value : 'none';
}
export function normalizeLanguage(value) {
    return value === 'en' || value === 'zh' ? value : 'auto';
}
