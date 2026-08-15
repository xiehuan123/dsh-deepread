// 缓存持久化端到端测试：以真实 JSON 文件模拟官方 storage 后端，
// 验证 miss→落盘→hit（不联网）→新实例（模拟重启）仍命中→refresh 重抓→TTL=0 不缓存。
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-cache-'))
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

const fakeJson = JSON.stringify({ title: '缓存验证', summary: '摘要', thesis: '论点', arguments: [], quotes: [], concepts: [], questions: [] })
const CACHE_FILE = join(tmp, 'storages', 'deepread_url_cache.json')
const HTML = '<html><head><title>缓存端到端文章</title></head><body><p>这是缓存端到端验证正文。</p></body></html>'

// ---- 文件后端 storageDomain shim（对齐官方 json 后端 unit 结构） ----
function makeFileStorageDomain() {
  return {
    async open(spec) {
      const data = new Map()
      try {
        const parsed = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
        assert.equal(parsed.unit.name, spec.name, 'unit 名与领域声明一致')
        assert.equal(parsed.unit.version, 1)
        for (const [k, v] of Object.entries(parsed.tables.articles || {})) data.set(k, v)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      return {
        async close() {},
        table() {
          return {
            get: (k) => data.get(k),
            put: async (k, v) => { data.set(k, v); await flush() },
            delete: async (k) => { data.delete(k); await flush() },
            entries: () => data.entries(),
            keys: () => data.keys(),
          }
        },
      }
      async function flush() {
        await mkdir(dirname(CACHE_FILE), { recursive: true })
        const unit = { unit: { name: 'deepread_url_cache', version: 1 }, global: null, tables: { articles: Object.fromEntries(data) } }
        await writeFile(CACHE_FILE, JSON.stringify(unit), 'utf8')
      }
    },
  }
}

function makeCtx(storageDomain, opts = {}) {
  const holder = { fetchCalls: 0 }
  holder.web = {
    fetch: async () => { holder.fetchCalls++; return { statusCode: 200, body: { kind: 'html', content: HTML } } },
  }
  holder.ctx = {
    get: (name) => {
      if (name === 'storageDomain') return storageDomain
      if (name === 'web') return holder.web
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* () {
        yield { type: 'text-delta', text: fakeJson }
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  holder.applyConfig = opts.config
  return holder
}

const URL = (n) => `https://mp.weixin.qq.com/s/e2e-cache-check-${n}`

// 场景 1：首次抓取 miss → 落盘
{
  const h = makeCtx(makeFileStorageDomain())
  mod.apply(h.ctx, undefined)
  const r1 = await h.tool.execute({ url: URL(1), depth: 'quick', export: 'none' })
  assert.equal(r1.meta.cache, 'miss')
  assert.equal(h.fetchCalls, 1)
  const onDisk = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
  const rec = onDisk.tables.articles[URL(1)]
  assert.ok(rec, '缓存记录已写入磁盘文件')
  assert.ok(typeof rec.fetchedAt === 'string' && rec.text.includes('缓存端到端验证正文'), '记录含 url/text/fetchedAt')
  console.log('CACHE E2E 1/5: miss 后已写入磁盘 deepread_url_cache.json')
}

// 场景 2：同进程第二次 → hit，不再联网
{
  const h = makeCtx(makeFileStorageDomain())
  mod.apply(h.ctx, undefined)
  await h.tool.execute({ url: URL(2), depth: 'quick', export: 'none' })
  const r2 = await h.tool.execute({ url: URL(2), depth: 'quick', export: 'none' })
  assert.equal(r2.meta.cache, 'hit')
  assert.equal(h.fetchCalls, 1)
  console.log('CACHE E2E 2/5: 同进程二次调用命中缓存，fetch 次数保持 1')
}

// 场景 3：全新实例（新 apply/新 ctx，后端从磁盘重读）→ 模拟进程重启后仍命中
{
  const h0 = makeCtx(makeFileStorageDomain())
  mod.apply(h0.ctx, undefined)
  await h0.tool.execute({ url: URL(3), depth: 'quick', export: 'none' })
  const h = makeCtx(makeFileStorageDomain())
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ url: URL(3), depth: 'quick', export: 'none' })
  assert.equal(r.meta.cache, 'hit', '重启后从磁盘恢复的条目应直接命中')
  assert.equal(h.fetchCalls, 0, '重启后命中不应发起任何网络请求')
  console.log('CACHE E2E 3/5: 模拟重启（新实例从磁盘重读）后仍命中，零联网')
}

// 场景 4：refresh: true → 强制重抓
{
  const h = makeCtx(makeFileStorageDomain())
  mod.apply(h.ctx, undefined)
  await h.tool.execute({ url: URL(4), depth: 'quick', export: 'none' })
  const r = await h.tool.execute({ url: URL(4), depth: 'quick', export: 'none', refresh: true })
  assert.equal(r.meta.cache, 'miss')
  assert.equal(h.fetchCalls, 2)
  console.log('CACHE E2E 4/5: refresh 强制重新抓取')
}

// 场景 5：cacheTtlHours: 0 → 永不命中
{
  const h = makeCtx(makeFileStorageDomain())
  mod.apply(h.ctx, { cacheTtlHours: 0 })
  await h.tool.execute({ url: URL(5), depth: 'quick', export: 'none' })
  const r = await h.tool.execute({ url: URL(5), depth: 'quick', export: 'none' })
  assert.equal(r.meta.cache, 'miss')
  assert.equal(h.fetchCalls, 2)
  console.log('CACHE E2E 5/5: TTL=0 时禁用缓存，每次都重新抓取')
}

await rm(tmp, { recursive: true, force: true })
console.log('CACHE E2E OK: 持久化后端 miss/hit/重启恢复/refresh/ttl 全部按预期工作')
