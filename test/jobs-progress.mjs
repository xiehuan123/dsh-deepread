// 后台任务进度透明测试：mock jobs 服务验证长文/批量转后台、进度、取消、前台降级。
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-jobs-'))
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

const sectionJson = JSON.stringify({ title: '后台精读标题', summary: '摘要', thesis: '论点', arguments: [], quotes: [], concepts: [], questions: [] })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function makeCtx(opts = {}) {
  const holder = { calls: 0, slowMs: opts.slowMs || 0 }
  const jobsState = { started: 0, spec: null, hooks: null }
  let jobs
  if (opts.withJobs !== false) {
    jobs = {
      async start(spec) {
        jobsState.started++
        jobsState.spec = spec
        jobsState.hooks = spec.run() // 同步拿到 hooks，并触发后台计算
        return 'deepread-1'
      },
    }
  }
  holder.ctx = {
    get: (name) => {
      if (name === 'jobs') return jobs
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* () {
        holder.calls++
        yield { type: 'text-delta', text: sectionJson }
        if (holder.slowMs > 0) await delay(holder.slowMs)
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  holder.jobsState = jobsState
  return holder
}

const LONG_TEXT = '字'.repeat(10000)

// 场景 1：长文本 deep → 后台；done completed；进度行 + 最终报告
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' }, { agent: 'agent-1' })
  assert.equal(r.kind, 'background')
  assert.equal(r.jobId, 'deepread-1')
  assert.equal(h.jobsState.started, 1)
  assert.equal(h.jobsState.spec.kind, 'deepread')
  assert.equal(h.jobsState.spec.owner, 'agent-1')
  assert.equal(h.jobsState.spec.outputLimitBytes, 65536)
  assert.ok(h.jobsState.spec.label.includes('deepread 精读'), 'label 形如 deepread 精读「…」· N 段')
  assert.ok(h.jobsState.spec.label.includes('段'), 'label 含段数')
  const hooks = h.jobsState.hooks
  assert.ok(hooks, 'start 返回 hooks')
  const doneResult = await hooks.done
  assert.equal(doneResult.status, 'completed')
  const out1 = hooks.readOutput()
  assert.ok(out1.includes('精读第 1/2 段'), '进度行含分段开始')
  assert.ok(out1.includes('汇总中'), '进度行含汇总')
  assert.ok(out1.includes('【最终报告】'), '含最终报告')
  assert.ok(out1.includes('后台精读标题'), '含报告标题')
  const out2 = hooks.readOutput()
  assert.equal(out2, '', 'readOutput 读完清空')
  console.log('JOBS 1/5: 长文 deep 后台 → jobId=deepread-1，进度/汇总/最终报告齐全')
}

// 场景 2：短文本 quick → 前台（不产生 job）
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: '短文本', depth: 'quick', export: 'none' })
  assert.equal(r.kind, 'article')
  assert.equal(h.jobsState.started, 0, 'quick 不产生后台任务')
  assert.equal(h.jobsState.hooks, null)
  console.log('JOBS 2/5: 短文本 quick 前台 kind=article，无 job')
}

// 场景 3：无 jobs 服务 + 长文本 → 前台正常出报告
{
  const h = makeCtx({ withJobs: false })
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' })
  assert.equal(r.kind, 'article')
  assert.equal(r.title, '后台精读标题')
  assert.equal(h.jobsState.started, 0)
  console.log('JOBS 3/5: 无 jobs 长文本前台出报告')
}

// 场景 4：cancel() 后 done 以 killed 结算
{
  const h = makeCtx({ slowMs: 80 })
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' })
  assert.equal(r.kind, 'background')
  const hooks = h.jobsState.hooks
  await delay(20) // 让后台进入 llm 流（正在 slowMs 延迟中）
  hooks.cancel('用户取消')
  const doneResult = await hooks.done
  assert.equal(doneResult.status, 'killed')
  assert.equal(doneResult.detail, '用户取消')
  console.log('JOBS 4/5: cancel 后 done.status=killed')
}

// 场景 5：batch 恒后台
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ batch: [{ text: 'aa'.repeat(200) }, { text: 'bb'.repeat(200) }], export: 'none' })
  assert.equal(r.kind, 'background')
  assert.equal(r.jobId, 'deepread-1')
  assert.ok(h.jobsState.spec.label.includes('2 篇文档'), 'batch 标签含篇数')
  const doneResult = await h.jobsState.hooks.done
  assert.equal(doneResult.status, 'completed')
  console.log('JOBS 5/5: batch 恒后台，label=' + h.jobsState.spec.label)
}

console.log('JOBS PROGRESS OK')
