import { Config as legacyConfig, apply as legacyApply, inject as legacyInject, name as legacyName, } from '../legacy/index.mjs';
export const name = legacyName;
export const Config = legacyConfig;
export const inject = legacyInject;
export function apply(ctx, config) {
    legacyApply(ctx, config);
}
