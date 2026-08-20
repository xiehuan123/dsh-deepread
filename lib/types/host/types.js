export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isHostContext(value) {
    if (!isRecord(value) || !isRecord(value.tools))
        return false;
    const fileServiceValid = value.fs === undefined || isRecord(value.fs);
    const llmServiceValid = value.llm === undefined || isRecord(value.llm);
    return fileServiceValid && llmServiceValid
        && typeof value.effect === 'function'
        && typeof value.get === 'function'
        && typeof value.tools.register === 'function';
}
export function isBinaryFileService(value) {
    return isRecord(value)
        && typeof value.resolve === 'function'
        && typeof value.readBytes === 'function';
}
export function isTextFileService(value) {
    return isRecord(value)
        && typeof value.resolve === 'function'
        && typeof value.readText === 'function';
}
export function isFileWriter(value) {
    return isRecord(value)
        && typeof value.resolve === 'function'
        && typeof value.writeText === 'function';
}
export function isLlmCatalogService(value) {
    return isRecord(value)
        && typeof value.listProviders === 'function'
        && typeof value.listModels === 'function';
}
export function isLlmStreamService(value) {
    return isRecord(value)
        && typeof value.stream === 'function';
}
export function errorMessage(error) {
    return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}
