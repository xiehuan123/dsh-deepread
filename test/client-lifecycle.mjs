import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createEffectContext, createRuntimeStub, createSlotHarness } from './helpers/client-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const upstreamRoot = process.env.DSH_HARNESS_ROOT ?? '/Users/xiehuan/Desktop/project/deepseek-harness'
const upstreamSystem = join(upstreamRoot, 'packages/client/modules/lib/types/client/system.js')
if (!existsSync(upstreamSystem)) {
  console.log('CLIENT LIFECYCLE SKIP: set DSH_HARNESS_ROOT to a built DeepSeek Harness checkout for the real loader smoke')
  process.exit(0)
}

const styleNodes = []
const documentStub = {
  head: {
    appendChild(node) { node.parentNode = this; styleNodes.push(node) },
    removeChild(node) { const index = styleNodes.indexOf(node); if (index !== -1) styleNodes.splice(index, 1); node.parentNode = null },
  },
  createElement() {
    return { parentNode: null, textContent: '', setAttribute(name, value) { this[name] = value } }
  },
  querySelectorAll(selector) {
    if (selector !== 'style[data-plugin]') return []
    return styleNodes.filter((node) => typeof node['data-plugin'] === 'string')
  },
}

let activeHooks = null
let hookIndex = 0
const effectCleanups = []
const React = {
  createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } } },
  useState(initial) {
    const index = hookIndex++
    if (activeHooks[index] === undefined) activeHooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    const hooks = activeHooks
    return [hooks[index].value, (value) => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value }]
  },
  useEffect(effect) { hookIndex++; const cleanup = effect(); if (typeof cleanup === 'function') effectCleanups.push(cleanup) },
  useRef(initial) { const index = hookIndex++; if (activeHooks[index] === undefined) activeHooks[index] = { current: initial }; return activeHooks[index] },
  Fragment: Symbol('fragment'),
}

const previousDocument = globalThis.document
const previousWindow = globalThis.window
globalThis.document = documentStub
globalThis.window = globalThis
const { ClientModuleSystem } = await import(pathToFileURL(upstreamSystem).href)
const system = new ClientModuleSystem({
  modules: [{ id: 'dsh-deepread', url: pathToFileURL(join(root, 'lib', 'client.js')).href, rev: 'test' }],
  staticModules: { react: React, '@deepseek-ai/dsh-client-runtime/client': createRuntimeStub() },
  loadBundle: async (url) => { await import(url + '?loader=' + Date.now()) },
})

try {
  const mod = await system.import('dsh-deepread')
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots', 'sessions', 'conversation'])

  const harness = createSlotHarness()
  const injectionDisposers = []
  const inject = harness.slots.inject
  harness.slots.inject = (name, provider) => {
    const dispose = inject(name, provider)
    injectionDisposers.push(dispose)
    return dispose
  }
  const ctx = createEffectContext({
    slots: harness.slots,
    sessions: { list: { getSnapshot: () => ({ current: undefined }) } },
    conversation: { input: { for() { throw new Error('not used') } } },
  })
  mod.apply(ctx)
  assert.deepEqual([...harness.registrations.keys()], ['shell.overlay', 'conversation.input.left', 'tool.call.toolview'])
  assert.equal(styleNodes.length, 1)

  const panelHooks = []
  activeHooks = panelHooks
  hookIndex = 0
  harness.registrations.get('shell.overlay')()
  const composerElement = harness.registrations.get('conversation.input.left')({})
  const composerButton = composerElement.type(composerElement.props)
  composerButton.props.onClick()
  assert.equal(harness.instances.get('shell.overlay').getSnapshot().open, true)

  for (const dispose of injectionDisposers.splice(0).reverse()) dispose()
  ctx.dispose()
  assert.equal(harness.registrations.size, 0)
  assert.equal(harness.instances.size, 0)
  assert.equal(styleNodes.length, 0)
  for (const cleanup of effectCleanups) cleanup()
} finally {
  delete globalThis.__ModuleLoader__
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

console.log('CLIENT LIFECYCLE: upstream loader materializes bundle; three slots, store seat, and style dispose cleanly')
