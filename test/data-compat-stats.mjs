import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'
import { createFixtureStorageDomain, readStorageRecord } from './helpers/storage-domain.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const fixturePath = join(testDir, 'fixtures', 'v0.5.4', 'deepread-stats-v1.json')
const fixtureBytes = await readFile(fixturePath)
const fixture = JSON.parse(fixtureBytes.toString('utf8'))
const baseline = JSON.parse(await readFile(join(testDir, 'fixtures', 'v0.5.4', 'public-contract.json'), 'utf8'))

const oldStorage = createFixtureStorageDomain([fixture])
const currentPluginReadingLegacyFixture = await loadPluginEntry(root, 'published')
try {
  const holder = currentPluginReadingLegacyFixture.createContext({ storageDomain: oldStorage.service })
  currentPluginReadingLegacyFixture.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ text: '旧 stats fixture。', depth: 'deep', estimate: true })
  assert.equal(result.estimate.estTokensPerSecond, fixture.record.rateTokPerSec)
  assert.equal(result.estimate.estLatencyPerCallMs, fixture.record.latencyMs)
  assert.deepEqual(await readStorageRecord(oldStorage.service, fixture.domain, fixture.version, fixture.table, fixture.key), fixture.record)
} finally {
  await currentPluginReadingLegacyFixture.cleanup()
}

const newStorage = createFixtureStorageDomain([])
const currentPluginWritingV1 = await loadPluginEntry(root, 'published')
try {
  const holder = currentPluginWritingV1.createContext({ modelResult: baseline.modelResult, storageDomain: newStorage.service })
  currentPluginWritingV1.module.apply(holder.ctx, undefined)
  await holder.tool.execute({ text: '当前 stats writer。', depth: 'quick', export: 'none' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const record = await readStorageRecord(newStorage.service, 'deepread_stats', 1, 'stats', 'default')
  assert.deepEqual(Object.keys(record).sort(), ['calls', 'latencyMs', 'rateTokPerSec', 'updatedAt'])
} finally {
  await currentPluginWritingV1.cleanup()
}


const legacyPluginReadingCurrentWrite = await loadPluginEntry(root, 'legacy-0.5.4')
try {
  const holder = legacyPluginReadingCurrentWrite.createContext({ storageDomain: newStorage.service })
  legacyPluginReadingCurrentWrite.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ text: '0.5.4 读取当前 stats。', depth: 'deep', estimate: true })
  assert.equal(result.estimate.calibrated, true)
  const record = await readStorageRecord(newStorage.service, 'deepread_stats', 1, 'stats', 'default')
  assert.equal(result.estimate.estTokensPerSecond, Math.round(record.rateTokPerSec * 10) / 10)
  assert.equal(result.estimate.estLatencyPerCallMs, Math.round(record.latencyMs))
} finally {
  await legacyPluginReadingCurrentWrite.cleanup()
}

const damagedRecord = { rateTokPerSec: 'fast', latencyMs: -1, calls: {}, updatedAt: 42 }
const damagedStorage = createFixtureStorageDomain([{ ...fixture, record: damagedRecord }])
const damagedPlugin = await loadPluginEntry(root, 'published')
try {
  const holder = damagedPlugin.createContext({ storageDomain: damagedStorage.service })
  damagedPlugin.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ text: '损坏 stats 降级。', depth: 'deep', estimate: true })
  assert.equal(result.estimate.calibrated, false)
  assert.deepEqual(await readStorageRecord(damagedStorage.service, fixture.domain, fixture.version, fixture.table, fixture.key), damagedRecord)
} finally {
  await damagedPlugin.cleanup()
}

assert.deepEqual(await readFile(fixturePath), fixtureBytes)
console.log('DATA COMPAT STATS: old→new, new→0.5.4, damaged input unchanged')
