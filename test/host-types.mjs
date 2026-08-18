import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const hostConfig = JSON.parse(await readFile(join(root, 'tsconfig.host.json'), 'utf8'))

assert.equal(hostConfig.compilerOptions.strict, true)
await execFileAsync('npm', ['run', 'typecheck:host'], { cwd: root })
await execFileAsync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--project',
  join(testDir, 'fixtures', 'host-consumer', 'tsconfig.json'),
], { cwd: root })

console.log('HOST TYPES 1/1: strict TypeScript checks the Host source and package-root consumer contract')
