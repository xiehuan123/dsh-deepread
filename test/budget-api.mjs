// 面板直调 API 测试：POST /api/deepread/budget 路由注册 + 文本/错误/方法校验。
// 构造 fake webServer 捕获路由，fake req/res 走完整 handler；不联网（text 输入）。
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-budgetapi-'))
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
assert.equal(mod.name, 'deepread')

// fake ctx：webServer 为 inject 硬依赖，挂在 ctx 属性上（Cordis 注入形态），捕获注册的路由。
const holder = {}
const ctx = {
  get: () => undefined,
  effect: (fn) => { fn(); return () => {} },
  llm: {
    listProviders: () => [{ id: 'fake' }],
    listModels: async () => ['fake-model'],
  },
  tools: { register: () => {} },
  webServer: { register: (route) => { holder.route = route; return () => {} } },
}

mod.apply(ctx, undefined)
assert.ok(holder.route, 'route registered when webServer is present')
assert.equal(holder.route.kind, 'exact')
assert.equal(holder.route.path, '/api/deepread/budget')
assert.equal(typeof holder.route.handler, 'function')

// fake res：捕获 statusCode / headers / body。
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    end(payload) { this.body = payload },
  }
}

// fake req：EventEmitter + destroy。
function makeReq(method, rawBody) {
  const req = new EventEmitter()
  req.method = method
  req.destroyed = false
  req.destroy = () => { req.destroyed = true }
  queueMicrotask(() => {
    if (typeof rawBody === 'string') req.emit('data', Buffer.from(rawBody, 'utf-8'))
    req.emit('end')
  })
  return req
}

// 1) text 输入：ok、五模式、deep 行字段完整。
const res1 = makeRes()
const req1 = makeReq('POST', JSON.stringify({ text: '这是一段用于面板预算预检测试的文字内容，长度适中。'.repeat(20) }))
await holder.route.handler(req1, res1)
assert.equal(res1.statusCode, 200)
assert.equal(res1.headers['content-type'], 'application/json; charset=utf-8')
const data1 = JSON.parse(res1.body)
assert.equal(data1.ok, true)
assert.equal(data1.sourceKind, 'text')
assert.equal(typeof data1.chars, 'number')
assert.ok(data1.chars > 0, 'chars > 0')
assert.equal(data1.modes.length, 5, 'five modes')
assert.deepEqual(data1.modes.map((m) => m.mode), ['quick', 'deep', 'book', 'map', 'feynman'])
const deep1 = data1.modes.find((m) => m.mode === 'deep')
assert.equal(typeof deep1.totalTokens, 'number')
assert.ok(deep1.totalTokens > 0)
assert.equal(typeof deep1.minutes, 'number')
assert.equal(typeof data1.estTokensPerSecond, 'number')
assert.equal(typeof data1.estLatencyPerCallMs, 'number')
assert.equal(data1.calibrated, false)

// 2) 空输入：ok=false + error。
const res2 = makeRes()
const req2 = makeReq('POST', JSON.stringify({ url: '', path: '', text: '   ' }))
await holder.route.handler(req2, res2)
assert.equal(res2.statusCode, 200)
const data2 = JSON.parse(res2.body)
assert.equal(data2.ok, false)
assert.equal(typeof data2.error, 'string')

// 3) 非 POST：405。
const res3 = makeRes()
const req3 = makeReq('GET', '')
await holder.route.handler(req3, res3)
assert.equal(res3.statusCode, 405)
const data3 = JSON.parse(res3.body)
assert.equal(data3.ok, false)

// 4) 非法 JSON 请求体：500 + error。
const res4 = makeRes()
const req4 = makeReq('POST', '{not json')
await holder.route.handler(req4, res4)
assert.equal(res4.statusCode, 500)
const data4 = JSON.parse(res4.body)
assert.equal(data4.ok, false)
assert.equal(typeof data4.error, 'string')

console.log('BUDGET API OK: route registered, text/empty/method/bad-json paths all pass')
