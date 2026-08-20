import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const testDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(testDir)
const output = await mkdtemp(join(tmpdir(), 'dsh-deepread-pack-'))
const cache = await mkdtemp(join(tmpdir(), 'dsh-deepread-npm-cache-'))

try {
  const { stdout } = await execFileAsync('npm', [
    'pack', '--json', '--cache', cache, '--pack-destination', output,
  ], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  })
  const match = /\[\s*\{\s*"id"/.exec(stdout)
  if (match === null) throw new Error(`npm pack did not return JSON: ${stdout}`)
  const [packed] = JSON.parse(stdout.slice(match.index))
  const files = packed.files.map((file) => file.path).sort()
  const archive = join(output, packed.filename)

  for (const expected of [
    'dsh-plugin.json',
    'cordis.patch.yml',
    'skills/dsh-deepread/SKILL.md',
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    'plugin.json',
    'lib/types/index.js',
    'lib/types/index.d.ts',
    'lib/client.js',
    'lib/client.js.map',
    'src/client/index.ts',
    'src/client/models.ts',
    'src/client/storage.ts',
    'src/client/store.ts',
    'src/client/view.ts',
  ]) {
    assert.ok(files.includes(expected), `npm tarball includes ${expected}`)
  }
  assert.ok(!files.includes('src/client/index.js'), 'npm tarball excludes the retired JavaScript client source')

  const { stdout: manifestSource } = await execFileAsync('tar', [
    '-xOf', archive, 'package/dsh-plugin.json',
  ])
  const manifest = JSON.parse(manifestSource)
  assert.deepEqual(Object.keys(manifest.facets), ['host'])
  assert.ok(!Object.hasOwn(manifest, 'provides'))
  assert.ok(!Object.hasOwn(manifest.requires, 'services'))

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.version, packageJson.version)

  console.log('DSH-TUI PACK 1/1: npm tarball contains the complete Host-only cross-agent package')
} finally {
  await Promise.all([
    rm(output, { recursive: true, force: true }),
    rm(cache, { recursive: true, force: true }),
  ])
}
