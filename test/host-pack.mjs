import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { npmPackFileList } from './helpers/npm-pack.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const files = await npmPackFileList(root)

assert.ok(files.includes('lib/types/index.js'), 'package includes the built Host runtime entry')
assert.ok(files.includes('lib/types/index.d.ts'), 'package includes the Host declaration entry')
assert.ok(files.includes('lib/types/host/plugin.js'), 'package includes the compiled TypeScript Host runtime')
assert.ok(files.includes('lib/types/host/types.d.ts'), 'package includes explicit Host domain declarations')
assert.ok(!files.some((file) => file.startsWith('lib/legacy/') || file.startsWith('legacy/')), 'package excludes legacy Host runtime and boundary declarations')
assert.ok(files.includes('src/index.ts'), 'package includes the TypeScript Host source entry')
assert.ok(!files.includes('index.mjs'), 'package no longer publishes or depends on the root legacy entry')

console.log('HOST PACK 1/1: public package contains built Host artifacts without the root legacy entry')
