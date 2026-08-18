import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRuntimeStub } from './helpers/client-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const upstreamRoot = process.env.DSH_HARNESS_ROOT ?? '/Users/xiehuan/Desktop/project/deepseek-harness'
const upstreamSystem = join(upstreamRoot, 'packages/client/modules/lib/types/client/system.js')
const upstreamSlots = join(upstreamRoot, 'packages/client/ui-slots/lib/types/index.js')
const upstreamRenderer = join(upstreamRoot, 'packages/client/web-react/lib/types/index.js')
if (![upstreamSystem, upstreamSlots, upstreamRenderer].every(existsSync)) {
  console.log('CLIENT DRAG SKIP: set DSH_HARNESS_ROOT to a built DeepSeek Harness checkout for the real loader/slot smoke')
  process.exit(0)
}

const upstreamRequire = createRequire(pathToFileURL(join(upstreamRoot, 'package.json')))
const webReactRequire = createRequire(pathToFileURL(join(upstreamRoot, 'packages/client/web-react/package.json')))
const reactDomRequire = createRequire(pathToFileURL(join(upstreamRoot, 'packages/test-support/client-runtime/package.json')))
const { JSDOM } = await import(pathToFileURL(upstreamRequire.resolve('jsdom')).href)
const React = await import(pathToFileURL(webReactRequire.resolve('react')).href)
const { createRoot } = await import(pathToFileURL(reactDomRequire.resolve('react-dom/client')).href)
const { ClientModuleSystem } = await import(pathToFileURL(upstreamSystem).href)
const { SlotCore } = await import(pathToFileURL(upstreamSlots).href)
const { createSlotRenderer, SessionProvider } = await import(pathToFileURL(upstreamRenderer).href)

const globalNames = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'PointerEvent',
  'MouseEvent', 'getComputedStyle', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT',
]
const previousGlobals = Object.fromEntries(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'http://127.0.0.1/',
})
const browserWindow = dom.window
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'PointerEvent', 'MouseEvent', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: name === 'window' ? browserWindow : browserWindow[name],
  })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true })
Object.defineProperty(browserWindow, 'innerWidth', { configurable: true, writable: true, value: 800 })
Object.defineProperty(browserWindow, 'innerHeight', { configurable: true, writable: true, value: 600 })

const windowListeners = new Map()
const nativeAddEventListener = browserWindow.addEventListener.bind(browserWindow)
const nativeRemoveEventListener = browserWindow.removeEventListener.bind(browserWindow)
browserWindow.addEventListener = (type, listener, options) => {
  const listeners = windowListeners.get(type) ?? new Set()
  listeners.add(listener)
  windowListeners.set(type, listeners)
  nativeAddEventListener(type, listener, options)
}
browserWindow.removeEventListener = (type, listener, options) => {
  windowListeners.get(type)?.delete(listener)
  nativeRemoveEventListener(type, listener, options)
}

const captures = new WeakMap()
browserWindow.HTMLElement.prototype.setPointerCapture = function setPointerCapture(pointerId) {
  const active = captures.get(this) ?? new Set()
  active.add(pointerId)
  captures.set(this, active)
}
browserWindow.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
  return captures.get(this)?.has(pointerId) ?? false
}
browserWindow.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(pointerId) {
  captures.get(this)?.delete(pointerId)
}

function observable(value) {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

function hostOver(core) {
  const sessionInfo = observable({ sessionId: 'session-drag', hooks: {}, props: {} })
  return {
    subscribe: (key, listener) => core.subscribe(key, listener),
    getVersion: (key) => core.getVersion(key),
    entriesOf: (key) => core.entries(key),
    entriesOfSlot: (key) => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => core.reportEntryError(key, entry, error, info),
    specOf: (key) => core.specDynamic(key),
    isLive: (entry) => core.isLive(entry),
    storeOf: () => undefined,
    sessions: {
      list: observable({ ids: ['session-drag'], byId: {}, current: 'session-drag' }),
      provideInfo: sessionInfo,
    },
    workspaces: { list: observable({ items: [], phase: 'ready' }) },
  }
}

function effectContext(base) {
  const disposers = []
  const ctx = {
    ...base,
    effect(execute) {
      const dispose = execute()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {
        const index = disposers.indexOf(dispose)
        if (index !== -1) disposers.splice(index, 1)
        if (typeof dispose === 'function') dispose()
      }
    },
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
  return ctx
}

function pointer(type, pointerId, pointerType, clientX, clientY, init = {}) {
  return new browserWindow.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType,
    clientX,
    clientY,
    button: type === 'pointerdown' ? 0 : -1,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    ...init,
  })
}

async function dispatch(target, event) {
  await React.act(async () => {
    target.dispatchEvent(event)
    await Promise.resolve()
  })
}

async function click(target) {
  await React.act(async () => {
    target.dispatchEvent(new browserWindow.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    await Promise.resolve()
  })
}

const core = new SlotCore()
const Frame = (props) => React.createElement(React.Fragment, null,
  React.createElement(SessionProvider, null, () => props.renderSlot('conversation.input.left', {})),
  props.renderSlot('shell.overlay', {}),
)
const disposeFrame = core.register({
  name: 'root',
  children: {
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.input.left': { kind: 'list', scope: 'session' },
    'tool.call.toolview': { kind: 'keyed', scope: 'session' },
  },
}, Frame)
const host = hostOver(core)
const renderer = createSlotRenderer()
let currentContext
const slots = {
  register: (...args) => core.register(...args),
  inject(name, provider) {
    assert.notEqual(core.specDynamic(name), undefined, `official slot ${name} must be declared before injection`)
    return currentContext.effect(provider)
  },
}
const createContext = () => {
  currentContext = effectContext({
    slots,
    sessions: { list: { getSnapshot: () => ({ current: undefined }) } },
    conversation: { input: { for() { throw new Error('not used') } } },
  })
  return currentContext
}

const system = new ClientModuleSystem({
  modules: [{ id: 'dsh-deepread', url: pathToFileURL(join(root, 'lib', 'client.js')).href, rev: 'drag-dom-test' }],
  staticModules: { react: React, '@deepseek-ai/dsh-client-runtime/client': createRuntimeStub() },
  loadBundle: async (url) => { await import(url + '?loader=' + Date.now()) },
})
browserWindow.__ModuleLoader__ = globalThis.__ModuleLoader__

let reactRoot
let ctx
try {
  const mod = await system.import('dsh-deepread')
  ctx = createContext()
  mod.apply(ctx)
  const container = browserWindow.document.getElementById('app')
  reactRoot = createRoot(container)
  await React.act(async () => {
    reactRoot.render(renderer.renderRoot(host, {}))
    await Promise.resolve()
  })

  const composer = () => browserWindow.document.querySelector('.dr-composer-btn')
  const panel = () => browserWindow.document.querySelector('.dr-panel')
  const header = () => browserWindow.document.querySelector('.dr-panel-head')
  const close = () => browserWindow.document.querySelector('.dr-close')
  await click(composer())
  assert.ok(panel(), 'official loader and slot renderer mount the panel into real DOM')

  let panelWidth = 420
  const panelHeight = 500
  const headerHeight = 32
  const defaultRect = { left: 364, top: 56 }
  const attachRects = () => {
    panel().getBoundingClientRect = () => {
      const left = panel().style.left === '' ? defaultRect.left : Number.parseFloat(panel().style.left)
      const top = panel().style.top === '' ? defaultRect.top : Number.parseFloat(panel().style.top)
      return { left, top, width: panelWidth, height: panelHeight, right: left + panelWidth, bottom: top + panelHeight, x: left, y: top, toJSON() {} }
    }
    header().getBoundingClientRect = () => {
      const rect = panel().getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: panelWidth, height: headerHeight, right: rect.left + panelWidth, bottom: rect.top + headerHeight, x: rect.left, y: rect.top, toJSON() {} }
    }
  }
  attachRects()

  await dispatch(header(), pointer('pointerdown', 7, 'mouse', 400, 70))
  assert.equal(header().hasPointerCapture(7), true, 'pointerdown captures the real DOM pointer target')
  await dispatch(header(), pointer('pointermove', 7, 'mouse', 600, 120))
  assert.equal(panel().style.left, '380px', 'mouse drag changes observable DOM left and clamps the right edge')
  assert.equal(panel().style.top, '106px', 'mouse drag changes observable DOM top')
  await dispatch(header(), pointer('pointerup', 7, 'mouse', 600, 120))
  assert.equal(header().hasPointerCapture(7), false, 'pointerup releases capture')

  await dispatch(header(), pointer('pointerdown', 8, 'touch', 400, 120))
  await dispatch(header(), pointer('pointermove', 8, 'touch', -1000, -1000))
  assert.equal(panel().style.left, '0px', 'touch shares the Pointer Events path and clamps left')
  assert.equal(panel().style.top, '0px', 'touch shares the Pointer Events path and clamps top')
  await dispatch(header(), pointer('pointercancel', 8, 'touch', -1000, -1000))
  assert.equal(header().hasPointerCapture(8), false, 'pointercancel releases capture')
  await dispatch(header(), pointer('pointermove', 8, 'touch', 700, 500))
  assert.equal(panel().style.cssText, 'left: 0px; top: 0px; right: auto;', 'cancelled pointers cannot move the DOM again')

  await dispatch(header(), pointer('pointerdown', 9, 'pen', 10, 10))
  await dispatch(header(), pointer('pointermove', 9, 'pen', 1000, 1000))
  assert.equal(panel().style.left, '380px', 'pen shares the path and clamps right')
  assert.equal(panel().style.top, '568px', 'pen shares the path and keeps the complete title bar visible')
  header().releasePointerCapture(9)
  await dispatch(header(), pointer('lostpointercapture', 9, 'pen', 1000, 1000))
  await dispatch(header(), pointer('pointermove', 9, 'pen', 20, 20))
  assert.equal(panel().style.top, '568px', 'lost capture ends the drag')

  const positionBeforeClose = panel().style.cssText
  await dispatch(close(), pointer('pointerdown', 10, 'mouse', 760, 580))
  assert.equal(header().hasPointerCapture(10), false, 'interactive title descendants do not start drag')
  assert.equal(panel().style.cssText, positionBeforeClose, 'close pointerdown causes zero position change')
  assert.equal(panel().onpointerdown, null, 'content panel does not own a pointerdown handler')
  assert.equal(browserWindow.document.querySelector('.dr-input').onpointerdown, null, 'inputs do not own the title drag handler')

  assert.equal(windowListeners.get('resize')?.size, 1, 'one component resize listener is mounted')
  browserWindow.innerWidth = 300
  browserWindow.innerHeight = 200
  panelWidth = 268
  await React.act(async () => {
    browserWindow.dispatchEvent(new browserWindow.Event('resize'))
    await Promise.resolve()
  })
  assert.equal(panel().style.left, '32px', 'resize clamps the panel horizontally')
  assert.equal(panel().style.top, '168px', 'resize leaves the complete title bar visible')

  await dispatch(header(), pointer('pointerdown', 12, 'mouse', 50, 180))
  browserWindow.innerWidth = 800
  browserWindow.innerHeight = 600
  panelWidth = 420
  await React.act(async () => {
    browserWindow.dispatchEvent(new browserWindow.Event('resize'))
    await Promise.resolve()
  })
  await dispatch(header(), pointer('pointermove', 12, 'mouse', 2000, 180))
  assert.equal(panel().style.left, '380px', 'an active drag re-reads current geometry after resize')
  await dispatch(header(), pointer('pointerup', 12, 'mouse', 2000, 180))

  const retainedPosition = panel().style.cssText
  await click(close())
  assert.equal(panel(), null, 'close hides the panel')
  assert.equal(windowListeners.get('resize')?.size ?? 0, 0, 'close removes the resize listener')
  await click(composer())
  assert.equal(panel().style.cssText, retainedPosition, 'close/reopen retains position for this apply lifecycle')
  assert.equal(windowListeners.get('resize')?.size, 1, 'reopen installs one resize listener')

  attachRects()
  await dispatch(header(), pointer('pointerdown', 13, 'mouse', 400, 180))
  const externallyClosedHeader = header()
  assert.equal(externallyClosedHeader.hasPointerCapture(13), true, 'external-close coverage begins with active capture')
  await click(composer())
  assert.equal(panel(), null, 'composer can close the panel during drag')
  assert.equal(externallyClosedHeader.hasPointerCapture(13), false, 'close during drag releases capture')
  await click(composer())
  assert.equal(panel().style.cssText, retainedPosition, 'reopen after interrupted drag keeps apply-scope position')

  await React.act(async () => { reactRoot.unmount(); await Promise.resolve() })
  assert.equal(windowListeners.get('resize')?.size ?? 0, 0, 'DOM unmount removes the resize listener')
  reactRoot = createRoot(container)
  await React.act(async () => { reactRoot.render(renderer.renderRoot(host, {})); await Promise.resolve() })
  assert.equal(panel().style.cssText, retainedPosition, 'same-apply DOM remount retains position')
  assert.equal(windowListeners.get('resize')?.size, 1, 'same-apply remount installs one resize listener')

  panel().getBoundingClientRect = () => ({ left: 380, top: 168, width: panelWidth, height: panelHeight, right: 800, bottom: 668, x: 380, y: 168, toJSON() {} })
  header().getBoundingClientRect = () => ({ left: 380, top: 168, width: panelWidth, height: headerHeight, right: 800, bottom: 200, x: 380, y: 168, toJSON() {} })
  await dispatch(header(), pointer('pointerdown', 14, 'mouse', 400, 180))
  assert.equal(header().hasPointerCapture(14), true, 'dispose coverage begins with active capture')
  const capturedHeader = header()
  await React.act(async () => {
    ctx.dispose()
    await Promise.resolve()
  })
  assert.equal(capturedHeader.hasPointerCapture(14), false, 'plugin disposal releases active capture')
  assert.equal(windowListeners.get('resize')?.size ?? 0, 0, 'plugin disposal removes the window listener')
  assert.equal(browserWindow.document.querySelectorAll('style[data-plugin="dsh-deepread"]').length, 0, 'plugin disposal removes styles')
  assert.equal(core.entries('shell.overlay').length, 0, 'plugin disposal removes the official slot contribution')
  assert.equal(browserWindow.localStorage.length, 0, 'drag position is never persisted')

  ctx = createContext()
  mod.apply(ctx)
  await React.act(async () => { await Promise.resolve() })
  await click(composer())
  assert.equal(panel().style.cssText, '', 'a fresh apply lifecycle starts at the CSS default position')

  const css = [...browserWindow.document.querySelectorAll('style[data-plugin="dsh-deepread"]')].map((node) => node.textContent).join('\n')
  assert.match(css, /touch-action:\s*none/, 'title handle disables touch panning only on itself')
  assert.match(css, /user-select:\s*none/, 'title handle suppresses selection only on itself')
  assert.match(css, /cursor:\s*grabbing/, 'dragging has immediate cursor feedback')
  assert.doesNotMatch(css, /\.dr-panel(?:-dragging)?[^}]*\b(?:animation|transition)\s*:/, 'drag feedback has no motion to gate for reduced motion')
} finally {
  if (ctx !== undefined) ctx.dispose()
  if (reactRoot !== undefined) await React.act(async () => { reactRoot.unmount() })
  disposeFrame()
  dom.window.close()
  delete globalThis.__ModuleLoader__
  for (const [name, descriptor] of Object.entries(previousGlobals)) {
    if (descriptor === undefined) delete globalThis[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
}

console.log('CLIENT DRAG: real DOM PointerEvents pass through the official loader, SlotCore, and slot renderer')
