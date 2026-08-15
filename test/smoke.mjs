// Node half 冒烟测试：在临时目录注入 @deepseek-ai/* shim，
// 直接调用 apply + execute，验证工具注册、callModelJson 可达、quick 路径与渲染。
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-smoke-'))
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

await copyFile(join(root, 'index.mjs'), join(tmp, 'index.mjs'))
const mod = await import(pathToFileURL(join(tmp, 'index.mjs')).href)
assert.equal(mod.name, 'deepread')

const fakeJson = JSON.stringify({ title: '冒烟标题', summary: '冒烟摘要', thesis: '冒烟论点', arguments: [], quotes: [], concepts: [], questions: [] })

function makeCtx() {
  const holder = {}
  holder.ctx = {
    get: (name) => (name === 'agentDefaultModel' || name === 'sandboxPolicy' || name === 'web' ? undefined : undefined),
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
  return holder
}

// 默认配置路径
const a = makeCtx()
mod.apply(a.ctx, undefined)
assert.ok(a.tool, 'tool registered')
assert.equal(a.tool.name, 'deepread')
assert.equal(a.tool.timeoutMs, 900000, 'default timeoutMs')

const value = await a.tool.execute({ text: '这是一段用于冒烟测试的文字。', depth: 'quick', export: 'none' })
assert.equal(value.kind, 'article')
assert.equal(value.title, '冒烟标题')
const blocks = a.tool.output.render({}, value)
assert.ok(blocks[0].text.includes('# 📖 精读报告'), 'render produces markdown report')
assert.ok(blocks[0].text.includes('冒烟标题'), 'rendered report carries the title')

// Config 覆盖路径
const b = makeCtx()
mod.apply(b.ctx, { timeoutMs: 123456 })
assert.equal(b.tool.timeoutMs, 123456, 'config timeoutMs override applied')

console.log('SMOKE OK: tool registers, callModelJson reachable, quick path executes and renders, config override works')
