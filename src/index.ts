import { Config as ConfigSchema } from './host/plugin.js'
import type { Config as ConfigOptions } from './host/types.js'

export { apply, inject, name } from './host/plugin.js'
export const Config = ConfigSchema
export type Config = ConfigOptions
