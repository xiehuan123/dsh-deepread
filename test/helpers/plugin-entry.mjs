import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ENTRY_PATHS = { typescript: './lib/types/index.js' }
const LEGACY_054_COMMIT = 'cbfffab353112180456a6c26ed83de092d54ac12'

async function writeModule(directory, name, source) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }))
  await writeFile(join(directory, 'index.js'), source)
}

async function installPeerShims(packageDir) {
  const scope = join(packageDir, 'node_modules', '@deepseek-ai')

  await writeModule(join(scope, 'dsh-tools'), '@deepseek-ai/dsh-tools', [
    'export function defineTool(tool) { return tool }',
    '',
  ].join('\n'))

  await writeModule(join(scope, 'schemastery'), '@deepseek-ai/schemastery', [
    'function primitive(type) {',
    '  return () => ({ type, defaultValue: undefined, default(value) { this.defaultValue = value; return this } })',
    '}',
    'export default {',
    "  object: (properties) => ({ type: 'object', properties }),",
    "  number: primitive('number'),",
    "  string: primitive('string'),",
    "  boolean: primitive('boolean'),",
    "  union: (...members) => ({ type: 'union', members, defaultValue: undefined, default(value) { this.defaultValue = value; return this } }),",
    '}',
    '',
  ].join('\n'))

  await writeModule(join(scope, 'dsh-storage-domain'), '@deepseek-ai/dsh-storage-domain', [
    'export function defineDomain(spec) { return spec }',
    'export function domainTable(keySchema, recordSchema) { return { keySchema, recordSchema } }',
    '',
  ].join('\n'))

  await writeModule(join(packageDir, 'node_modules', 'zod'), 'zod', [
    'function schema(type, shape) { return { type, shape } }',
    "export const z = { object: (shape) => schema('object', shape), string: () => schema('string'), number: () => schema('number') }",
    '',
  ].join('\n'))
}

function publishedEntry(packageJson) {
  const rootExport = packageJson.exports?.['.']
  if (typeof rootExport === 'string') return rootExport
  if (rootExport !== null && typeof rootExport === 'object') {
    if (typeof rootExport.import === 'string') return rootExport.import
    if (typeof rootExport.default === 'string') return rootExport.default
  }
  if (typeof packageJson.main === 'string') return packageJson.main
  throw new Error('package.json does not declare a published root entry')
}

export async function loadPluginEntry(root, target = 'published') {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-deepread-entry-'))
  const packageDir = join(tempRoot, 'package')
  await mkdir(packageDir, { recursive: true })

  for (const path of ['package.json']) {
    await cp(join(root, path), join(packageDir, path))
  }
  await cp(join(root, 'lib'), join(packageDir, 'lib'), { recursive: true })
  if (target === 'legacy-0.5.4') {
    const legacySource = execFileSync('git', ['show', `${LEGACY_054_COMMIT}:index.mjs`], { cwd: root, encoding: 'utf8' })
    await writeFile(join(packageDir, 'index.mjs'), legacySource)
  }
  await installPeerShims(packageDir)

  const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const relativeEntry = target === 'published'
    ? publishedEntry(packageJson)
    : target === 'legacy-0.5.4'
      ? './index.mjs'
      : ENTRY_PATHS[target]
  if (relativeEntry === undefined) throw new Error(`unknown plugin entry target: ${target}`)
  const module = await import(pathToFileURL(join(packageDir, relativeEntry)).href)

  return {
    module,
    packageDir,
    createContext(options = {}) {
      const holder = { tool: null, effects: [] }
      holder.ctx = {
        get(name) {
          if (name === 'storageDomain') return options.storageDomain
          if (name === 'web') return options.web
          return undefined
        },
        effect(register) {
          const dispose = register()
          if (typeof dispose === 'function') holder.effects.push(dispose)
          return dispose
        },
        llm: {
          listProviders: () => [{ id: 'fixture-provider' }],
          listModels: async () => [{ id: 'fixture-model' }],
          stream: async function* () {
            yield { type: 'text-delta', text: JSON.stringify(options.modelResult ?? {}) }
            yield { type: 'finish', reason: null }
          },
        },
        tools: {
          register(tool) {
            holder.tool = tool
            return () => { holder.tool = null }
          },
        },
      }
      return holder
    },
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true })
    },
  }
}
