import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

assert.equal(packageJson.main, './lib/types/index.js')
assert.equal(packageJson.types, './lib/types/index.d.ts')
assert.deepEqual(packageJson.exports['.'], {
  types: './lib/types/index.d.ts',
  import: './lib/types/index.js',
})

const loaded = await loadPluginEntry(root, 'published')
try {
  assert.deepEqual(Object.keys(loaded.module).sort(), ['Config', 'apply', 'inject', 'name'])
  assert.equal(loaded.module.name, 'deepread')
  assert.equal(typeof loaded.module.Config, 'object')
  assert.equal(typeof loaded.module.apply, 'function')
  assert.deepEqual(loaded.module.inject, [
    'fs',
    'llm',
    'tools',
    'web',
    'agentDefaultModel',
    'sandboxPolicy',
  ])
} finally {
  await loaded.cleanup()
}

console.log('PACKAGE ENTRY 1/1: Node ESM consumers load the built Host entry and stable public surface')
