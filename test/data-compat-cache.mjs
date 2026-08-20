import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'
import { createFixtureStorageDomain, readStorageRecord } from './helpers/storage-domain.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const fixturePath = join(testDir, 'fixtures', 'v0.5.4', 'deepread-url-cache-v1.json')
const fixtureBytes = await readFile(fixturePath)
const fixture = JSON.parse(fixtureBytes.toString('utf8'))
const baseline = JSON.parse(await readFile(join(testDir, 'fixtures', 'v0.5.4', 'public-contract.json'), 'utf8'))

const oldStorage = createFixtureStorageDomain([fixture])
const currentPluginReadingLegacyFixture = await loadPluginEntry(root, 'published')
try {
  const holder = currentPluginReadingLegacyFixture.createContext({
    modelResult: baseline.modelResult,
    storageDomain: oldStorage.service,
    web: { fetch: async () => assert.fail('old cache fixture must avoid networking') },
  })
  currentPluginReadingLegacyFixture.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ url: fixture.key, depth: 'quick', export: 'none' })
  assert.equal(result.meta.cache, 'hit')
  assert.deepEqual(await readStorageRecord(oldStorage.service, fixture.domain, fixture.version, fixture.table, fixture.key), fixture.record)
} finally {
  await currentPluginReadingLegacyFixture.cleanup()
}

const newStorage = createFixtureStorageDomain([])
const currentPluginWritingV1 = await loadPluginEntry(root, 'published')
const url = 'https://mp.weixin.qq.com/s/dr-150-new-writer'
try {
  const holder = currentPluginWritingV1.createContext({
    modelResult: baseline.modelResult,
    storageDomain: newStorage.service,
    web: { fetch: async () => ({ statusCode: 200, body: { kind: 'html', content: '<html><head><title>DR-150</title></head><body><p>当前 writer 兼容旧 reader。</p></body></html>' } }) },
  })
  currentPluginWritingV1.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ url, depth: 'quick', export: 'none' })
  assert.equal(result.meta.cache, 'miss')
  const record = await readStorageRecord(newStorage.service, 'deepread_url_cache', 1, 'articles', url)
  assert.deepEqual(Object.keys(record).sort(), ['fetchedAt', 'text', 'url'])
} finally {
  await currentPluginWritingV1.cleanup()
}

const legacyPluginReadingCurrentWrite = await loadPluginEntry(root, 'legacy-0.5.4')
try {
  const holder = legacyPluginReadingCurrentWrite.createContext({
    modelResult: baseline.modelResult,
    storageDomain: newStorage.service,
    web: { fetch: async () => assert.fail('0.5.4 must read the current v1 cache without networking') },
  })
  legacyPluginReadingCurrentWrite.module.apply(holder.ctx, undefined)
  const result = await holder.tool.execute({ url, depth: 'quick', export: 'none' })
  assert.equal(result.meta.cache, 'hit')
} finally {
  await legacyPluginReadingCurrentWrite.cleanup()
}

const damagedRecord = { url: 17, text: null, fetchedAt: 'not-a-date' }
const damagedFixture = { ...fixture, record: damagedRecord }
const damagedStorage = createFixtureStorageDomain([damagedFixture])
const damagedPlugin = await loadPluginEntry(root, 'published')
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => { throw new Error('network disabled for damaged cache test') }
  const holder = damagedPlugin.createContext({
    modelResult: baseline.modelResult,
    storageDomain: damagedStorage.service,
    web: { fetch: async () => { throw new Error('network disabled for damaged cache test') } },
  })
  damagedPlugin.module.apply(holder.ctx, undefined)
  await assert.rejects(holder.tool.execute({ url: fixture.key, depth: 'quick', export: 'none' }))
  assert.deepEqual(await readStorageRecord(damagedStorage.service, fixture.domain, fixture.version, fixture.table, fixture.key), damagedRecord)
} finally {
  globalThis.fetch = originalFetch
  await damagedPlugin.cleanup()
}

assert.deepEqual(await readFile(fixturePath), fixtureBytes)
console.log('DATA COMPAT CACHE: old→new, new→0.5.4, damaged input unchanged')
