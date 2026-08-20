import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

assert.equal(packageJson.scripts['typecheck:browser'], 'tsc --project tsconfig.browser.json --noEmit')
await execFileAsync('npm', ['run', 'typecheck:browser'], { cwd: root })
await access(join(root, 'src', 'client', 'index.ts'))
await assert.rejects(access(join(root, 'src', 'client', 'index.js')))
assert.ok(packageJson.files.includes('src/**/*.ts'))
assert.ok(!packageJson.files.includes('src/client/index.js'))

for (const entry of await readdir(join(root, 'src', 'client'))) {
  if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
  const source = await readFile(join(root, 'src', 'client', entry), 'utf8')
  assert.doesNotMatch(source, /from ['"]node:|require\(['"]node:/, `${entry} must not import Node built-ins`)
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck)/, `${entry} must remain strictly checked`)
  assert.doesNotMatch(source, /\bany\b/, `${entry} must narrow unknown instead of using any`)
}

console.log('BROWSER TYPESCRIPT RUNTIME: strict browser typecheck and TypeScript-only source entry')
