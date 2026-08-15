// PDF 提取测试：ObjStm/XRef 流支持。
// 用法：node test/pdf-objstm.mjs [额外PDF路径...]
// 冒烟目标：test/fixtures/objstm.pdf（Root/Pages/Page/Font 全部驻留 ObjStm，xref 为 XRef 流）
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-pdf-'))
const scope = join(tmp, 'node_modules', '@deepseek-ai')

const dshToolsDir = join(scope, 'dsh-tools')
await mkdir(dshToolsDir, { recursive: true })
await writeFile(join(dshToolsDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', main: 'index.js' }))
await writeFile(join(dshToolsDir, 'index.js'), 'export function defineTool(tool){ return tool }\n')

const schemasteryDir = join(scope, 'schemastery')
await mkdir(schemasteryDir, { recursive: true })
await writeFile(join(schemasteryDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', type: 'module', main: 'index.js' }))
await writeFile(join(schemasteryDir, 'index.js'), [
  'const primitive = () => ({ default: (d) => d })',
  'export default { object: (props) => props, number: primitive, string: primitive, boolean: primitive, union: () => ({ default: (d) => d }) }',
  '',
].join('\n'))

const storageDomainDir = join(scope, 'dsh-storage-domain')
await mkdir(storageDomainDir, { recursive: true })
await writeFile(join(storageDomainDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-storage-domain', type: 'module', main: 'index.js' }))
await writeFile(join(storageDomainDir, 'index.js'), [
  'export function defineDomain(spec){ if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(\'domain name must match [a-z][a-z0-9_]*\'); return spec }',
  'export function domainTable(keySchema, recordSchema){ return { keySchema, recordSchema } }',
  '',
].join('\n'))

const zodDir = join(tmp, 'node_modules', 'zod')
await mkdir(zodDir, { recursive: true })
await writeFile(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', type: 'module', main: 'index.js' }))
await writeFile(join(zodDir, 'index.js'), [
  'export const z = { object: (shape) => ({ shape }), string: () => ({ type: \'string\' }) }',
  '',
].join('\n'))

await copyFile(join(root, 'index.mjs'), join(tmp, 'index.mjs'))
const mod = await import(pathToFileURL(join(tmp, 'index.mjs')).href)

const fakeJson = JSON.stringify({ title: 'PDF 冒烟', summary: '摘要', thesis: '论点', arguments: [], quotes: [], concepts: [], questions: [] })

async function extractPdf(path, expectText) {
  const holder = { prompts: [] }
  holder.ctx = {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {} },
    fs: {
      resolve: async (p) => resolve(p),
      readBytes: async (p) => await readFile(p),
    },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* (options) {
        holder.prompts.push(JSON.stringify(options))
        yield { type: 'text-delta', text: fakeJson }
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  mod.apply(holder.ctx, undefined)
  const value = await holder.tool.execute({ path, depth: 'quick', export: 'none' })
  assert.equal(value.kind, 'article')
  if (expectText) {
    const all = holder.prompts.join('\n')
    assert.ok(all.includes(expectText), `提取的文本应包含「${expectText}」，实际提示词：${all.slice(0, 300)}`)
  }
  return holder.prompts
}

// 场景 1：ObjStm fixture（Root/Pages/Page/Font 全在对象流里）
const fixture = join(root, 'test', 'fixtures', 'objstm.pdf')
await extractPdf(fixture, 'Hello ObjStm')
console.log('PDF OBJSTM OK: fixture parsed, text extracted through the deepread tool')

// 场景 2（可选）：命令行传入的真实 PDF
for (const extra of process.argv.slice(2)) {
  const p = resolve(extra)
  const holder = { prompts: [] }
  holder.ctx = {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {} },
    fs: { resolve: async (x) => resolve(x), readBytes: async (x) => await readFile(x) },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* (options) {
        holder.prompts.push(JSON.stringify(options))
        yield { type: 'text-delta', text: fakeJson }
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  mod.apply(holder.ctx, undefined)
  const value = await holder.tool.execute({ path: p, depth: 'quick', export: 'none' })
  assert.equal(value.kind, 'article')
  const all = holder.prompts.join('\n')
  const chars = all.length
  console.log(`PDF EXTRA OK: ${p} parsed (${value.title}), 提示词长度 ${chars}`)
}
