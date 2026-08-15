// 运行时自校准测试：快速 llm mock 累计滚动平均速率，estimate 反映校准；跨实例持久化。
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-calib-'))
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

const fakeJson = JSON.stringify({
  title: '校准测试标题',
  summary: '这是一段用于校准测试的摘要文本，包含足够多的中文字符以产生可观的 token 估算。',
  thesis: '运行时自校准能够根据实测吞吐调整预算预估。',
  arguments: [{ claim: '论点一', evidence: '证据一的详细说明内容。', quote: '', source: '' }],
  quotes: [],
  concepts: [{ term: '自校准', explanation: '用指数加权滚动平均修正速率与延迟' }],
  questions: [],
})

// 共享内存 Map 模拟 stats 域持久化后端（跨 apply 实例可见）
function makeStatsStore() {
  const map = new Map()
  return {
    map,
    storageDomain: {
      async open(spec) {
        return {
          async close() {},
          table() {
            return {
              get: (k) => map.get(k),
              put: async (k, v) => { map.set(k, v) },
              delete: async (k) => { map.delete(k) },
              entries: () => map.entries(),
              keys: () => map.keys(),
            }
          },
        }
      },
    },
  }
}

function makeCtx(store) {
  const holder = { calls: 0 }
  holder.ctx = {
    get: (name) => {
      if (name === 'storageDomain') return store.storageDomain
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* () {
        holder.calls++
        yield { type: 'text-delta', text: fakeJson }
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  return holder
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const store = makeStatsStore()

// 场景 1：连续 3 次 quick 调用后，第 4 次 estimate 反映校准生效（calibrated=true 且速率 > 30）
{
  const h = makeCtx(store)
  mod.apply(h.ctx, undefined)
  for (let i = 0; i < 3; i++) {
    const r = await h.tool.execute({ text: '校准测试短文本。', depth: 'quick', export: 'none' })
    assert.equal(r.kind, 'article')
  }
  assert.equal(h.calls, 3, '三次 quick 调用均走 llm')
  const r4 = await h.tool.execute({ text: '校准测试短文本。', depth: 'deep', estimate: true })
  assert.equal(r4.kind, 'estimate')
  assert.equal(r4.estimate.calibrated, true, '校准已生效')
  assert.ok(r4.estimate.estTokensPerSecond > 30, '实测速率应显著高于默认 30 tok/s，实际 ' + r4.estimate.estTokensPerSecond)
  assert.ok(typeof r4.estimate.estLatencyPerCallMs === 'number', '含校准延迟')
  console.log('CALIB 1/2: estimate.calibrated=true, rate=' + r4.estimate.estTokensPerSecond + ' tok/s, latency=' + r4.estimate.estLatencyPerCallMs + 'ms')
  await delay(20) // 等 persistCalibration 写回共享 Map
}

// 场景 2：新 apply 实例（模拟重启）从持久化后端读到一致校准值
{
  const h = makeCtx(store)
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: '校准测试短文本。', depth: 'deep', estimate: true })
  assert.equal(r.estimate.calibrated, true, '重启后仍读到校准')
  const persisted = store.map.get('default')
  assert.ok(persisted, 'stats 域已持久化')
  assert.ok(typeof persisted.rateTokPerSec === 'number' && persisted.rateTokPerSec > 30, '持久化速率 > 30')
  assert.ok(r.estimate.estTokensPerSecond >= 30 && Math.abs(r.estimate.estTokensPerSecond - persisted.rateTokPerSec) < 0.2, '新实例校准速率与持久化一致：estimate=' + r.estimate.estTokensPerSecond + ' persisted=' + persisted.rateTokPerSec)
  assert.equal(persisted.calls, 3, '跨实例累计调用次数为 3')
  console.log('CALIB 2/2: 新实例读到 rateTokPerSec=' + r.estimate.estTokensPerSecond + '（持久化 ' + persisted.rateTokPerSec + '），calls=' + persisted.calls)
}

console.log('CALIBRATION OK')
