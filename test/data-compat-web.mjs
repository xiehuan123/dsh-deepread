import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadClientBundle } from './helpers/client-bundle.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const fixturePath = join(testDir, 'fixtures', 'v0.5.4', 'web-local-storage.json')
const fixtureBytes = await readFile(fixturePath)
const fixture = JSON.parse(fixtureBytes.toString('utf8'))

const client = await loadClientBundle(root, fixture)
try {
  client.openPanel()
  let panel = client.renderPanel()
  panel = client.renderPanel()
  assert.match(JSON.stringify(panel), /旧版兼容性样例/)
  client.changeTextarea(panel, '兼容校准文本。'.repeat(1000))
  panel = client.renderPanel()
  assert.equal(client.readBudgetLine(panel), '预算：≈8.8k token · ≈1.8分钟')
  const instruction = client.rereadFirstHistoryItemAndSubmit()
  assert.match(instruction, /模式：深度精读/)
  assert.match(instruction, /https:\/\/example\.invalid\/compatibility/)
  assert.deepEqual(client.writtenKeys, [], 'reading old localStorage does not rewrite it')
} finally {
  client.cleanup()
}

const damaged = {
  history: { key: fixture.history.key, raw: '[{"broken":' },
  calibration: { key: fixture.calibration.key, raw: '{"rate":' },
}
const damagedClient = await loadClientBundle(root, damaged)
try {
  damagedClient.openPanel()
  let panel = damagedClient.renderPanel()
  panel = damagedClient.renderPanel()
  assert.doesNotMatch(JSON.stringify(panel), /旧版兼容性样例/)
  damagedClient.changeTextarea(panel, '损坏数据降级。'.repeat(1000))
  panel = damagedClient.renderPanel()
  assert.match(damagedClient.readBudgetLine(panel), /^预算：/)
  assert.equal(damagedClient.storedValue(fixture.history.key), damaged.history.raw)
  assert.equal(damagedClient.storedValue(fixture.calibration.key), damaged.calibration.raw)
  assert.deepEqual(damagedClient.writtenKeys, [])
} finally {
  damagedClient.cleanup()
}

assert.deepEqual(await readFile(fixturePath), fixtureBytes, 'the DR-100 fixture bytes remain unchanged')
console.log('DATA COMPAT WEB: 0.5.4 history/calibration load; damaged bytes degrade without writes')
