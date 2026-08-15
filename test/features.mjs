// 新功能测试：#10 预算预检、#4 引用溯源、#1 批量精读+跨篇对比
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-feat-'))
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

function makeCtx(outputs) {
  const holder = { calls: 0 }
  holder.ctx = {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {} },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* () {
        const out = outputs[Math.min(holder.calls, outputs.length - 1)]
        holder.calls++
        yield { type: 'text-delta', text: out }
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  return holder
}

// 场景 1：预算预检（estimate: true，不调用模型）
{
  const h = makeCtx([])
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: '中文内容测试。'.repeat(500), depth: 'deep', estimate: true })
  assert.equal(r.kind, 'estimate')
  assert.equal(h.calls, 0, 'estimate 模式不应调用模型')
  assert.ok(Array.isArray(r.estimate.modes) && r.estimate.modes.length === 5, '五种模式都有估算行')
  for (const m of r.estimate.modes) {
    assert.ok(m.totalTokens > 0, m.mode + ' 总 token > 0')
    assert.ok(typeof m.minutes === 'number' && m.minutes >= 0, m.mode + ' 有时间估算')
    assert.ok(m.calls >= 1, m.mode + ' 调用次数 >= 1')
  }
  const rendered = h.tool.output.render({}, r)[0].text
  assert.ok(rendered.includes('预算预检') && rendered.includes('| 模式 |'), '渲染出预算表格')
  console.log('FEAT 1/4: estimate 模式输出五模式 token/耗时表格，零模型调用')
}

// 场景 2：引用溯源（citations + arguments.source 渲染）
{
  const citJson = JSON.stringify({
    title: '溯源测试', summary: 's', thesis: 't',
    arguments: [{ claim: 'c', evidence: 'e', quote: 'q', source: '第3页' }],
    structure: [], concepts: [], questions: [],
    citations: [{ claim: 'c', source: '第3页', quote: 'q' }],
  })
  const h = makeCtx([citJson])
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: 'x'.repeat(100), depth: 'deep', export: 'none' })
  assert.equal(r.citations.length, 1)
  assert.equal(r.citations[0].source, '第3页')
  assert.equal(r.arguments[0].source, '第3页')
  const rendered = h.tool.output.render({}, r)[0].text
  assert.ok(rendered.includes('引用溯源'), '渲染出引用溯源区')
  assert.ok(rendered.includes('第3页'), '渲染保留页码')
  console.log('FEAT 2/4: 引用溯源字段透传并渲染页码定位')
}

// 场景 3：批量精读 + 跨篇对比
{
  const sectionA = JSON.stringify({ title: 'A文', summary: 'sa', thesis: 'ta', arguments: [{ claim: 'ca', evidence: 'ea', quote: '', source: '' }], quotes: [], concepts: [], questions: [] })
  const sectionB = JSON.stringify({ title: 'B文', summary: 'sb', thesis: 'tb', arguments: [], quotes: [], concepts: [], questions: [] })
  const batchFinal = JSON.stringify({ title: '两篇对比', comparison: [{ theme: '主题X', positions: [{ doc: 'A文', view: '观点a' }, { doc: 'B文', view: '观点b' }] }], conflicts: [{ theme: '冲突Y', positions: [{ doc: 'A文', view: 'a' }, { doc: 'B文', view: 'b' }] }], complementarity: '互补', synthesis: '综合', questions: ['追问'] })
  const h = makeCtx([sectionA, sectionB, batchFinal])
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ batch: [{ text: 'aa'.repeat(200) }, { text: 'bb'.repeat(200) }], export: 'none' })
  assert.equal(r.kind, 'batch')
  assert.equal(r.items.length, 2)
  assert.ok(Array.isArray(r.comparison.comparison) && r.comparison.comparison.length === 1)
  assert.ok(Array.isArray(r.comparison.conflicts) && r.comparison.conflicts.length === 1)
  assert.equal(h.calls, 3, '两篇 quick + 一次对比')
  const rendered = h.tool.output.render({}, r)[0].text
  assert.ok(rendered.includes('对比矩阵') && rendered.includes('冲突点'))
  assert.ok(rendered.includes('A文') && rendered.includes('主题X'))
  console.log('FEAT 3/4: batch 两篇 → 对比矩阵/冲突点/综合结论渲染')
}

// 场景 4：批量预算预检
{
  const h = makeCtx([])
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ batch: [{ text: 'x'.repeat(100) }, { text: 'y'.repeat(100) }], estimate: true })
  assert.equal(r.kind, 'estimate')
  assert.equal(r.estimate.batch, true)
  assert.equal(r.estimate.items.length, 2)
  assert.ok(r.estimate.totalCalls >= 3, '逐篇 + 对比调用')
  assert.ok(r.estimate.totalTokens > 0)
  const rendered = h.tool.output.render({}, r)[0].text
  assert.ok(rendered.includes('合计'))
  console.log('FEAT 4/4: batch estimate 输出逐篇估算与合计')
}
