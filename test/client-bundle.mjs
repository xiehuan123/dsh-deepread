// Client 工厂包契约测试：从 src 重建 lib/client.js，
// 在伪造的 window.__ModuleLoader__ 上加载，验证 C6 handoff、exports（apply/inject）
// 与三个 slot 注册（tool.call.toolview / conversation.input.left / shell.overlay）。
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'
import { createEffectContext, createRuntimeStub, createSlotHarness } from './helpers/client-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 从源码重建产物：保证测试验证的正是 TS 源与 tsdown 生成的 lib/client.js。
execFileSync('npm', ['run', 'build:client'], { cwd: root, stdio: 'pipe' })
const bundlePath = join(root, 'lib/client.js')

globalThis.window = globalThis
let handoff = null
window.__ModuleLoader__ = { load: (h) => { handoff = h } }
await import(pathToFileURL(bundlePath).href + '?smoke=' + Date.now())

assert.ok(handoff, 'bundle registers via window.__ModuleLoader__.load')
assert.equal(handoff.id, 'dsh-deepread')

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  Fragment: Symbol('fragment'),
}
const requireStub = (spec) => {
  if (spec === 'react') return reactStub
  if (spec === '@deepseek-ai/dsh-client-runtime/client') return createRuntimeStub()
  throw new Error('client bundle required an unexpected specifier: ' + spec)
}
const mod = handoff.factory(requireStub)
assert.equal(typeof mod.apply, 'function', 'factory exports apply')
assert.deepEqual(mod.inject, ['slots', 'sessions', 'conversation'], 'factory exports inject')

const slotNames = []
const harness = createSlotHarness()
const inject = harness.slots.inject
harness.slots.inject = (slot, provider) => { slotNames.push(slot); return inject(slot, provider) }
const fakeCtx = createEffectContext({
  slots: harness.slots,
  sessions: { list: { getSnapshot: () => ({ current: undefined }) } },
  conversation: { input: { for() { throw new Error('not used') } } },
})
mod.apply(fakeCtx)
assert.deepEqual(slotNames, ['shell.overlay', 'conversation.input.left', 'tool.call.toolview'])

const view = harness.registrations.get('tool.call.toolview')
assert.equal(typeof view, 'function')
const tree = view({
  block: { meta: { kind: 'article', title: 't', summary: 's', thesis: 'th', arguments: [], quotes: [], concepts: [], questions: [], chapters: [], meta: { chars: 10, depth: 'deep' } } },
})
assert.ok(tree.type(tree.props), 'result card renders an element tree')

console.log('CLIENT BUNDLE OK: C6 handoff + apply/inject exports + slot registrations')
