import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'
import { loadClientBundle } from './helpers/client-bundle.mjs'
import { createFixtureStorageDomain } from './helpers/storage-domain.mjs'
import { npmPackFileList } from './helpers/npm-pack.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const fixtureDir = join(testDir, 'fixtures', 'v0.5.4')

async function readJson(name) {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf8'))
}

const baseline = await readJson('public-contract.json')
const loaded = await loadPluginEntry(root, 'published')

try {
  assert.equal(loaded.module.name, 'deepread')
  assert.equal(typeof loaded.module.Config, 'object')
  assert.equal(typeof loaded.module.apply, 'function')
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.module.Config)), baseline.configSchema)

  const holder = loaded.createContext({
    modelResult: baseline.modelResult,
  })
  loaded.module.apply(holder.ctx, undefined)

  assert.ok(holder.tool, 'the published entry registers the deepread tool')
  assert.equal(holder.tool.name, 'deepread')
  assert.equal(holder.tool.timeoutMs, baseline.defaultTimeoutMs)
  assert.deepEqual(holder.tool.parameters, baseline.parameters)
  assert.deepEqual(holder.tool.output.schema, baseline.outputSchema)

  const result = await holder.tool.execute({
    text: baseline.quickInput,
    depth: 'quick',
    export: 'none',
  })
  assert.deepEqual({
    kind: result.kind,
    title: result.title,
    summary: result.summary,
    thesis: result.thesis,
    arguments: result.arguments,
    quotes: result.quotes,
    concepts: result.concepts,
    questions: result.questions,
    structure: result.structure,
    citations: result.citations,
    meta: {
      source: result.meta.source,
      sourceKind: result.meta.sourceKind,
      chars: result.meta.chars,
      chunks: result.meta.chunks,
      depth: result.meta.depth,
    },
  }, baseline.quickResult)
} finally {
  await loaded.cleanup()
}

console.log('COMPAT BASELINE 1/5: published exports, defaults, tool schema, and quick result match 0.5.4')

const webStorage = await readJson('web-local-storage.json')
const client = await loadClientBundle(root, webStorage)
try {
  client.openPanel()
  let panel = client.renderPanel()
  panel = client.renderPanel()

  assert.ok(JSON.stringify(panel).includes('旧版兼容性样例'), '0.5.4 history is visible in the panel')
  assert.deepEqual(client.readKeys, [
    'dsh-deepread-history-v1',
    'dsh-deepread-calib',
    'dsh-deepread-history-v1',
    'dsh-deepread-calib',
  ])

  client.changeTextarea(panel, '兼容校准文本。'.repeat(1000))
  panel = client.renderPanel()
  assert.equal(client.readBudgetLine(panel), '预算：≈8.8k token · ≈1.8分钟')
} finally {
  client.cleanup()
}

console.log('COMPAT BASELINE 2/5: browser reads the 0.5.4 history and calibration localStorage keys')

const cacheFixture = await readJson('deepread-url-cache-v1.json')
const cacheStorage = createFixtureStorageDomain([cacheFixture])
const cachePlugin = await loadPluginEntry(root, 'published')
try {
  const holder = cachePlugin.createContext({
    modelResult: baseline.modelResult,
    storageDomain: cacheStorage.service,
    web: { fetch: async () => assert.fail('a 0.5.4 cache hit must not access the network') },
  })
  cachePlugin.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ url: cacheFixture.key, depth: 'quick', export: 'none' })

  assert.equal(result.meta.cache, 'hit')
  assert.equal(result.meta.source, cacheFixture.key)
  assert.equal(result.meta.chars, cacheFixture.record.text.length)
  assert.deepEqual(cacheStorage.observed(cacheFixture.domain), {
    domain: 'deepread_url_cache',
    version: 1,
    tables: ['articles'],
    keys: [cacheFixture.key],
  })
} finally {
  await cachePlugin.cleanup()
}

console.log('COMPAT BASELINE 3/5: Host reads deepread_url_cache domain v1 table articles without networking')

const statsFixture = await readJson('deepread-stats-v1.json')
const statsStorage = createFixtureStorageDomain([statsFixture])
const statsPlugin = await loadPluginEntry(root, 'published')
try {
  const holder = statsPlugin.createContext({ storageDomain: statsStorage.service })
  statsPlugin.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ text: '校准读取样例。', depth: 'deep', estimate: true })

  assert.equal(result.kind, 'estimate')
  assert.equal(result.estimate.calibrated, true)
  assert.equal(result.estimate.estTokensPerSecond, statsFixture.record.rateTokPerSec)
  assert.equal(result.estimate.estLatencyPerCallMs, statsFixture.record.latencyMs)
  assert.deepEqual(statsStorage.observed(statsFixture.domain), {
    domain: 'deepread_stats',
    version: 1,
    tables: ['stats'],
    keys: ['default'],
  })
} finally {
  await statsPlugin.cleanup()
}

console.log('COMPAT BASELINE 4/5: Host estimates with deepread_stats domain v1 table stats key default')

const packBaseline = await readJson('npm-pack-files.json')
assert.deepEqual(await npmPackFileList(root), packBaseline.files)

console.log('COMPAT BASELINE 5/5: npm pack --dry-run public file list matches the 0.5.4 baseline')
