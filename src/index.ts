import {
  Config as legacyConfig,
  apply as legacyApply,
  inject as legacyInject,
  name as legacyName,
} from '../legacy/index.mjs'

export interface Config {
  timeoutMs?: number
  chunkChars?: number
  maxParts?: number
  maxInputChars?: number
  cacheEnabled?: boolean
  cacheTtlHours?: number
  estTokensPerSecond?: number
  estLatencyPerCallMs?: number
  backgroundMinChars?: number
}

export const name: 'deepread' = legacyName
export const Config: object = legacyConfig
export const inject: readonly string[] = legacyInject

export function apply(ctx: object, config?: Config): void {
  legacyApply(ctx, config)
}
