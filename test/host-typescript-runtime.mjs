import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { npmPackFileList } from './helpers/npm-pack.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const buildScript = await readFile(join(root, 'scripts', 'build-host.mjs'), 'utf8')
const entrySource = await readFile(join(root, 'src', 'index.ts'), 'utf8')
const files = await npmPackFileList(root)
const { resolveConfig } = await import('../lib/types/host/config.js')

assert.ok(!entrySource.includes('legacy'), 'published Host source must not delegate to legacy runtime code')
assert.ok(!buildScript.includes('legacy'), 'Host build must compile TypeScript instead of copying legacy runtime code')
assert.ok(!packageJson.files.some((entry) => entry.includes('legacy')), 'package allowlist must not publish legacy Host code')
assert.ok(!files.some((entry) => entry.startsWith('lib/legacy/') || entry.startsWith('legacy/')), 'packed artifact must exclude legacy Host code')

for (const modulePath of [
  'src/host/types.ts',
  'src/host/config.ts',
  'src/host/budget.ts',
  'src/host/calibration.ts',
  'src/host/cache.ts',
  'src/host/source.ts',
  'src/host/pdf.ts',
  'src/host/llm.ts',
  'src/host/analysis.ts',
  'src/host/export.ts',
  'src/host/plugin.ts',
]) {
  assert.ok(files.includes(modulePath), `packed artifact includes ${modulePath}`)
}

const zeroConfig = resolveConfig({
  timeoutMs: 0,
  chunkChars: 0,
  maxParts: 0,
  maxInputChars: 0,
  cacheTtlHours: 0,
  backgroundMinChars: 0,
})
assert.deepEqual(
  zeroConfig,
  {
    timeoutMs: 900000,
    chunkChars: 6000,
    maxParts: 20,
    maxInputChars: 400000,
    cacheEnabled: true,
    cacheTtlHours: 0,
    estTokensPerSecond: 0,
    estLatencyPerCallMs: 0,
    backgroundMinChars: 9000,
  },
  'legacy-positive config fields must treat zero as invalid while zero-valued estimate overrides remain supported',
)

console.log('HOST TYPESCRIPT RUNTIME 2/2: strict TypeScript packaging and legacy config fallback semantics')
