import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const hostOutputDir = join(root, 'lib', 'types')

await rm(hostOutputDir, { recursive: true, force: true })
await execFileAsync('npm', ['run', 'build:host'], { cwd: root })

await assert.doesNotReject(access(join(hostOutputDir, 'index.js')))
await assert.doesNotReject(access(join(hostOutputDir, 'index.d.ts')))

console.log('HOST BUILD 1/1: public build command creates clean JavaScript and declaration outputs')
