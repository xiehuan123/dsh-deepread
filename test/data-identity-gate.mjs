import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cache = await readFile(new URL('../src/host/cache.ts', import.meta.url), 'utf8')
const stats = await readFile(new URL('../src/host/calibration.ts', import.meta.url), 'utf8')
const client = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')

assert.match(cache, /name: 'deepread_url_cache',[\s\S]*?version: 1,[\s\S]*?tables: \{ articles:/)
assert.match(stats, /name: 'deepread_stats',[\s\S]*?version: 1,[\s\S]*?tables: \{ stats:/)
assert.match(stats, /table\.get\('default'\)/)
assert.match(stats, /table\.put\('default',/)
assert.match(client, /const HISTORY_KEY = 'dsh-deepread-history-v1'/)
assert.match(client, /const CALIB_KEY = 'dsh-deepread-calib'/)
assert.equal((client.match(/dsh-deepread-history-v1/g) ?? []).length, 1)
assert.equal((client.match(/dsh-deepread-calib/g) ?? []).length, 1)

console.log('DATA IDENTITY GATE: keys, domains, tables, default key, and schema version remain frozen')
