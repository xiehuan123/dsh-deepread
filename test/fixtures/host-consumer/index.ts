import { Config, apply, name, type Config as DeepreadConfig } from 'dsh-deepread'

const config = {
  timeoutMs: 30_000,
  cacheEnabled: true,
} satisfies DeepreadConfig

const schema: object = Config
const pluginName: 'deepread' = name

apply({}, config)

void schema
void pluginName

// @ts-expect-error cacheEnabled is boolean in the public Host contract.
const invalidConfig: DeepreadConfig = { cacheEnabled: 'yes' }
void invalidConfig
