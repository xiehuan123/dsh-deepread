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

function findElements(element, predicate, matches = []) {
  if (element === null || element === undefined) return matches
  if (Array.isArray(element)) {
    for (const child of element) findElements(child, predicate, matches)
    return matches
  }
  if (typeof element !== 'object') return matches
  if (predicate(element)) matches.push(element)
  const children = element.props?.children
  findElements(Array.isArray(children) ? children : [children], predicate, matches)
  return matches
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
  const renderPanel = () => {
    activeHooks = panelHooks
    hookIndex = 0
    const panelElement = harness.registrations.get('shell.overlay')()
    return panelElement.type(panelElement.props)
  }
  const renderComposerButton = () => {
    activeHooks = []
    hookIndex = 0
    const composerElement = harness.registrations.get('conversation.input.left')({})
    return composerElement.type(composerElement.props)
  }

  renderPanel()
  let composerButton = renderComposerButton()
  assert.equal(composerButton.type, 'button')
  assert.equal(composerButton.props['aria-label'], '打开精读助手')
  assert.equal(composerButton.props['aria-expanded'], false)
  assert.equal(composerButton.props['aria-controls'], 'deepread-panel')
  assert.equal(renderPanel(), null)

  composerButton.props.onClick()
  composerButton = renderComposerButton()
  assert.equal(composerButton.props['aria-label'], '关闭精读助手')
  assert.equal(composerButton.props['aria-expanded'], true)
  assert.notEqual(renderPanel(), null)

  composerButton.props.onClick()
  composerButton = renderComposerButton()
  assert.equal(composerButton.props['aria-expanded'], false)
  assert.equal(renderPanel(), null)

  composerButton.props.onClick()
  composerButton = renderComposerButton()
  assert.equal(composerButton.props['aria-expanded'], true)
  let panel = renderPanel()
  assert.notEqual(panel, null)
  assert.equal(findElements(panel, (element) => element.props?.className === 'dr-panel').length, 1)

  const closeButton = findElements(panel, (element) => element.props?.className === 'dr-close')[0]
  assert.equal(closeButton.type, 'button')
  assert.equal(closeButton.props['aria-label'], '关闭精读助手')
  closeButton.props.onClick()
  assert.equal(renderComposerButton().props['aria-expanded'], false)
  assert.equal(renderPanel(), null)

  composerButton = renderComposerButton()
  composerButton.props.onClick()
  composerButton.props.onClick()
  assert.equal(renderComposerButton().props['aria-expanded'], false, 'rapid double activation is deterministic')
  assert.equal(renderPanel(), null)
  for (let index = 0; index < 9; index++) composerButton.props.onClick()
  panel = renderPanel()
  assert.equal(renderComposerButton().props['aria-expanded'], true)
  assert.equal(findElements(panel, (element) => element.props?.className === 'dr-panel').length, 1)

  composerButton = renderComposerButton()
  assert.equal(composerButton.type, 'button')
  assert.equal(composerButton.props.type, 'button')
  assert.equal(typeof composerButton.props.onClick, 'function')
  assert.equal(composerButton.props.onKeyDown, undefined, 'native button owns Enter/Space activation')

  assert.equal(harness.hookSources.length, 2)
  assert.equal(new Set(harness.hookSources).size, 1, 'both slots observe one panel state source')
  assert.equal(harness.hookSources[0].listenerCount(), 2)

  harness.collapseSlot('shell.overlay')
  assert.equal(harness.registrations.has('shell.overlay'), false)
  assert.equal(harness.hookSources[0].listenerCount(), 1)
  harness.declareSlot('shell.overlay')
  assert.equal(harness.hookSources[0].listenerCount(), 2)
  assert.equal(new Set(harness.hookSources).size, 1, 'slot redeclaration reuses the same apply-owned state source')
  panel = renderPanel()
  assert.equal(findElements(panel, (element) => element.props?.className === 'dr-panel').length, 1)

  harness.collapseSlot('conversation.input.left')
  harness.collapseSlot('shell.overlay')
  assert.equal(harness.hookSources[0].listenerCount(), 0)
  assert.equal(harness.registrations.size, 1, 'only the unrelated tool card survives both target slot collapses')
  harness.declareSlot('shell.overlay')
  harness.declareSlot('conversation.input.left')
  assert.equal(harness.hookSources[0].listenerCount(), 2)
  assert.equal(renderComposerButton().props['aria-expanded'], true)
  assert.equal(findElements(renderPanel(), (element) => element.props?.className === 'dr-panel').length, 1)

  for (const dispose of injectionDisposers.splice(0).reverse()) dispose()
  ctx.dispose()
  assert.equal(harness.registrations.size, 0)
  assert.equal(harness.instances.size, 0)
  assert.equal(styleNodes.length, 0)
  assert.equal(harness.hookSources[0].listenerCount(), 0, 'slot unload releases old panel state subscriptions')
  composerButton.props.onClick()
  assert.equal(harness.registrations.size, 0, 'an old button callback cannot recreate disposed slot nodes')

  const remountHarness = createSlotHarness()
  const remountDisposers = []
  const remountInject = remountHarness.slots.inject
  remountHarness.slots.inject = (name, provider) => {
    const dispose = remountInject(name, provider)
    remountDisposers.push(dispose)
    return dispose
  }
  const remountCtx = createEffectContext({
    slots: remountHarness.slots,
    sessions: { list: { getSnapshot: () => ({ current: undefined }) } },
    conversation: { input: { for() { throw new Error('not used') } } },
  })
  mod.apply(remountCtx)
  assert.equal(remountHarness.registrations.size, 3)
  assert.equal(styleNodes.length, 1)
  activeHooks = []
  hookIndex = 0
  const remountedComposerElement = remountHarness.registrations.get('conversation.input.left')({})
  const remountedButton = remountedComposerElement.type(remountedComposerElement.props)
  assert.equal(remountedButton.props['aria-expanded'], false, 'remount starts from a fresh deterministic state')
  assert.equal(remountHarness.hookSources[0].listenerCount(), 2)

  for (const dispose of remountDisposers.splice(0).reverse()) dispose()
  remountCtx.dispose()
  assert.equal(remountHarness.registrations.size, 0)
  assert.equal(remountHarness.hookSources[0].listenerCount(), 0)
  assert.equal(styleNodes.length, 0)
  for (const cleanup of effectCleanups) cleanup()
} finally {
  delete globalThis.__ModuleLoader__
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

console.log('CLIENT LIFECYCLE: loader toggle, aria, single panel, native keyboard semantics, remount, subscriptions, and style dispose cleanly')
