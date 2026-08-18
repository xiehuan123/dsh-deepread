import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createEffectContext, createRuntimeStub, createSlotHarness } from './client-runtime.mjs'

function childrenOf(element) {
  if (element === null || element === undefined || typeof element !== 'object') return []
  const children = element.props?.children
  return Array.isArray(children) ? children : [children]
}

function findElement(element, predicate) {
  if (element === null || element === undefined) return null
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findElement(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (typeof element !== 'object') return null
  if (predicate(element)) return element
  return findElement(childrenOf(element), predicate)
}

export async function loadClientBundle(root, fixture) {
  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
  }
  const readKeys = []
  const writtenKeys = []
  const values = new Map([
    [fixture.history.key, fixture.history.raw ?? JSON.stringify(fixture.history.value)],
    [fixture.calibration.key, fixture.calibration.raw ?? JSON.stringify(fixture.calibration.value)],
  ])

  globalThis.window = globalThis
  globalThis.localStorage = {
    getItem(key) {
      readKeys.push(key)
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      writtenKeys.push(key)
      values.set(key, String(value))
    },
  }

  let handoff = null
  window.__ModuleLoader__ = { load(value) { handoff = value } }
  await import(pathToFileURL(join(root, 'lib', 'client.js')).href + '?compat=' + Date.now())
  if (handoff === null) throw new Error('client bundle did not register with the module loader')

  let activeHooks = null
  let hookIndex = 0
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } }
    },
    useState(initial) {
      const index = hookIndex++
      if (activeHooks[index] === undefined) {
        activeHooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const hooks = activeHooks
      return [activeHooks[index].value, (value) => {
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value
      }]
    },
    useEffect(effect) {
      hookIndex++
      effect()
    },
    useRef(initial) {
      const index = hookIndex++
      if (activeHooks[index] === undefined) activeHooks[index] = { current: initial }
      return activeHooks[index]
    },
    Fragment: Symbol('fragment'),
  }
  const module = handoff.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') return createRuntimeStub()
    throw new Error(`unexpected client dependency: ${specifier}`)
  })

  const harness = createSlotHarness()
  let draft = ''
  const submissions = []
  const ctx = createEffectContext({
    slots: harness.slots,
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-test' }) },
      scope: () => ({}),
    },
    conversation: {
      input: {
        for: () => ({
          setDraft(value) { draft = value },
          submit() { submissions.push(draft) },
        }),
      },
    },
  })
  module.apply(ctx)

  const composerHooks = []
  const panelHooks = []
  const historyItemHooks = []
  const composerWrapper = harness.registrations.get('conversation.input.left')
  const panelWrapper = harness.registrations.get('shell.overlay')
  if (typeof composerWrapper !== 'function' || typeof panelWrapper !== 'function') {
    throw new Error('client bundle did not register its public composer and overlay slots')
  }

  function renderFunctionElement(element, hooks) {
    activeHooks = hooks
    hookIndex = 0
    return element.type(element.props)
  }

  return {
    readKeys,
    writtenKeys,
    storedValue(key) { return values.get(key) },
    openPanel() {
      const button = renderFunctionElement(composerWrapper(), composerHooks)
      button.props.onClick()
    },
    renderPanel() {
      return renderFunctionElement(panelWrapper(), panelHooks)
    },
    rereadFirstHistoryItemAndSubmit() {
      let panel = renderFunctionElement(panelWrapper(), panelHooks)
      const item = findElement(panel, (element) => typeof element.type === 'function' && element.props?.item !== undefined)
      if (item === null) throw new Error('deepread panel history item was not rendered')
      let renderedItem = renderFunctionElement(item, historyItemHooks)
      const head = findElement(renderedItem, (element) => element.props?.className === 'dr-history-head')
      if (head === null) throw new Error('deepread history item header was not rendered')
      head.props.onClick()
      renderedItem = renderFunctionElement(item, historyItemHooks)
      const reread = findElement(renderedItem, (element) => element.props?.className === 'dr-history-reread')
      if (reread === null) throw new Error('deepread history reread action was not rendered')
      reread.props.onClick()
      panel = renderFunctionElement(panelWrapper(), panelHooks)
      const submit = findElement(panel, (element) => element.props?.className === 'dr-submit')
      if (submit === null) throw new Error('deepread panel submit action was not rendered')
      submit.props.onClick()
      return submissions.at(-1)
    },
    changeTextarea(panel, value) {
      const textarea = findElement(panel, (element) => element.type === 'textarea')
      if (textarea === null) throw new Error('deepread panel textarea was not rendered')
      textarea.props.onChange({ target: { value } })
    },
    readBudgetLine(panel) {
      const budget = findElement(panel, (element) => element.props?.className === 'dr-budget')
      if (budget === null) throw new Error('deepread panel budget line was not rendered')
      return budget.props.children.join('')
    },
    cleanup() {
      ctx.dispose()
      delete globalThis.__ModuleLoader__
      if (previous.window === undefined) delete globalThis.window
      else globalThis.window = previous.window
      if (previous.localStorage === undefined) delete globalThis.localStorage
      else globalThis.localStorage = previous.localStorage
    },
  }
}
