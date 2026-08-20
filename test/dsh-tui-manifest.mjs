import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(root, 'dsh-plugin.json'), 'utf8'))

assert.equal(manifest.manifestVersion, '0.15')
assert.equal(manifest.id, 'io.github.xiehuan123.dsh-deepread')
assert.equal(manifest.version, packageJson.version)
assert.deepEqual(manifest.facets, {
  host: {
    entry: './lib/types/index.js',
    apiVersion: 'v1alpha1',
  },
})
assert.deepEqual(manifest.requires, { contracts: [] })
assert.deepEqual(manifest.permissions, [])
assert.deepEqual(manifest.contributes, { commands: [] })
assert.deepEqual(manifest.subscriptions, [])
assert.ok(!Object.hasOwn(manifest, 'provides'))
assert.ok(!Object.hasOwn(manifest.requires, 'services'))

console.log('DSH-TUI MANIFEST 1/1: v0.15 manifest declares only the truthful Host facet')
