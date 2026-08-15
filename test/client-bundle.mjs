// Client 工厂包契约测试：从 src 重建 lib/client.js，
// 在伪造的 window.__ModuleLoader__ 上加载，验证 C6 handoff、exports（apply/inject）
// 与三个 slot 注册（tool.call.toolview / conversation.input.left / shell.overlay）。
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 从源码重建产物：保证测试验证的正是 src 与脚本生成的 lib/client.js。
execFileSync(process.execPath, [join(root, 'scripts/build-client.mjs')], { stdio: 'pipe' })
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
  throw new Error('client bundle required an unexpected specifier: ' + spec)
}
const mod = handoff.factory(requireStub)
assert.equal(typeof mod.apply, 'function', 'factory exports apply')
assert.deepEqual(mod.inject, ['slots', 'sessions', 'conversation'], 'factory exports inject')

const slotNames = []
const components = {}
const fakeCtx = {
  get: (name) => {
    if (name === 'slots') {
      return {
        inject: (slot, provider) => { slotNames.push(slot); provider() },
        register: (meta, component) => { components[meta.name] = component },
      }
    }
    return undefined
  },
}
mod.apply(fakeCtx)
assert.deepEqual(slotNames, ['tool.call.toolview', 'conversation.input.left', 'shell.overlay'])

const view = components['tool.call.toolview']
assert.equal(typeof view, 'function')
const tree = view({
  args: { depth: 'deep' },
  value: { kind: 'article', title: 't', summary: 's', thesis: 'th', arguments: [], quotes: [], concepts: [], questions: [], chapters: [], meta: { chars: 10, depth: 'deep' } },
})
assert.ok(tree, 'result card renders an element tree')

console.log('CLIENT BUNDLE OK: C6 handoff + apply/inject exports + slot registrations')
