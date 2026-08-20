import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEffectContext, createRuntimeStub, createSlotHarness } from './helpers/client-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const upstreamRoot = process.env.DSH_HARNESS_ROOT ?? '/Users/xiehuan/Desktop/project/deepseek-harness'
const forbiddenThemeColorPattern = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?:^|[,\s:(])(?:white|black|red|yellow|green|blue)(?=[\s,;/)}]|$)/i
// Audited against DeepSeek Harness 0.1.0-rc.7 ui-theme. This is deliberately
// a consumer allowlist: a new CSS token must be reviewed against the host
// contract before the plugin can use it.
const approvedThemeTokens = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-shadow-lv3',
])

const upstreamTokenFiles = [
  join(upstreamRoot, 'packages/client/ui-theme/src/styles/design-platform.css'),
  join(upstreamRoot, 'packages/client/ui-theme/src/styles/gradient-shadow-text.css'),
]
if (upstreamTokenFiles.every(existsSync)) {
  const upstreamTokens = new Set(
    [...upstreamTokenFiles.map((file) => readFileSync(file, 'utf8')).join('\n').matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)]
      .map((match) => match[1]),
  )
  for (const token of approvedThemeTokens) {
    assert.ok(upstreamTokens.has(token), `${token} remains defined by the local rc.7 ui-theme source`)
  }
}

execFileSync('npm', ['run', 'build:client'], { cwd: root, stdio: 'pipe' })

const styleNodes = []
const previousDocument = globalThis.document
const previousWindow = globalThis.window
globalThis.document = {
  head: {
    appendChild(node) { node.parentNode = this; styleNodes.push(node) },
    removeChild(node) {
      const index = styleNodes.indexOf(node)
      if (index !== -1) styleNodes.splice(index, 1)
      node.parentNode = null
    },
  },
  createElement() {
    return { parentNode: null, textContent: '', setAttribute(name, value) { this[name] = value } }
  },
}
globalThis.window = globalThis

let handoff = null
window.__ModuleLoader__ = { load(value) { handoff = value } }
await import(pathToFileURL(join(root, 'lib/client.js')).href + '?theme=' + Date.now())
assert.notEqual(handoff, null, 'client bundle registers with the real module loader handoff')

const React = {
  createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect() {},
  useRef(initial) { return { current: initial } },
  Fragment: Symbol('fragment'),
}

function childrenOf(element) {
  const children = element?.props?.children
  return Array.isArray(children) ? children : [children]
}

function renderTree(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element
  if (Array.isArray(element)) return element.map(renderTree)
  if (typeof element.type === 'function') return renderTree(element.type(element.props))
  return { ...element, props: { ...element.props, children: childrenOf(element).map(renderTree) } }
}

function findElements(element, predicate, matches = []) {
  if (element === null || element === undefined) return matches
  if (Array.isArray(element)) {
    for (const child of element) findElements(child, predicate, matches)
    return matches
  }
  if (typeof element !== 'object') return matches
  if (predicate(element)) matches.push(element)
  for (const child of childrenOf(element)) findElements(child, predicate, matches)
  return matches
}

function textContent(element) {
  if (element === null || element === undefined || typeof element === 'boolean') return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textContent).join('')
  return childrenOf(element).map(textContent).join('')
}
const module = handoff.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-runtime/client') return createRuntimeStub()
  throw new Error(`unexpected client dependency: ${specifier}`)
})
const harness = createSlotHarness()
const ctx = createEffectContext({
  slots: harness.slots,
  sessions: { list: { getSnapshot: () => ({ current: undefined }) } },
  conversation: { input: { for() { throw new Error('not used') } } },
})

try {
  module.apply(ctx)
  assert.equal(styleNodes.length, 1, 'client injects one runtime stylesheet')
  const css = styleNodes[0].textContent

  for (const literal of ['#fff', 'rgb(0, 0, 0)', 'hsl(0 0% 0%)', 'white', 'black', 'red', 'yellow', 'green', 'blue']) {
    assert.match(`color: ${literal};`, forbiddenThemeColorPattern, `theme-color gate rejects ${literal}`)
  }
  assert.doesNotMatch(css, forbiddenThemeColorPattern, 'runtime CSS contains no literal theme colors')
  assert.doesNotMatch(css, /prefers-color-scheme|data-ds-dark-theme/i, 'feature CSS does not own theme selection')

  const consumedTokens = [...css.matchAll(/var\((--dsw-[a-z0-9-]+)/gi)].map((match) => match[1])
  assert.ok(consumedTokens.length > 0, 'runtime CSS consumes host theme tokens')
  for (const token of consumedTokens) {
    assert.match(token, /^--dsw-(?:alias|shadow)-/, `${token} is a semantic theme token`)
    assert.ok(approvedThemeTokens.has(token), `${token} is approved from the rc.7 ui-theme contract`)
  }

  assert.match(css, /\.dr-input::placeholder\s*{[^}]*var\(--dsw-alias-label-secondary\)/, 'input placeholders use the contrast-safe host secondary label token')
  for (const confidenceClass of ['author', 'fact', 'infer', 'unknown']) {
    assert.match(
      css,
      new RegExp(`\\.dr-conf-${confidenceClass}\\s*\\{[^}]*color: var\\(--dsw-alias-label-primary\\)`),
      `${confidenceClass} confidence text uses the contrast-safe primary label token`,
    )
  }
  assert.match(css, /\.dr-(?:submit|preflight):disabled\s*{[^}]*var\(--dsw-alias-/, 'disabled actions have an explicit semantic-token state')
  assert.match(css, /\.dr-history-head:hover\s*{[^}]*var\(--dsw-alias-interactive-bg-hover\)/, 'history rows have a host-token hover state')

  const composerWrapper = harness.registrations.get('conversation.input.left')
  const panelWrapper = harness.registrations.get('shell.overlay')
  const composerButton = renderTree(composerWrapper({}))
  composerButton.props.onClick()
  const panel = renderTree(panelWrapper())
  const controls = [composerButton, ...findElements(panel, (element) => ['button', 'input', 'textarea'].includes(element.type))]
  assert.ok(controls.length > 10, 'the real panel DOM exposes all expected native controls')

  const focusVisibleClasses = new Set(
    [...css.matchAll(/\.([a-z0-9-]+):focus-visible/gi)].map((match) => match[1]),
  )
  for (const control of controls) {
    const classes = String(control.props.className ?? '').split(/\s+/).filter(Boolean)
    assert.ok(
      classes.some((className) => focusVisibleClasses.has(className)),
      `${control.type}.${classes.join('.')} has a visible keyboard focus rule`,
    )
  }


  const toolView = harness.registrations.get('tool.call.toolview')
  const confidenceLabels = ['作者原意', '原文事实与数据', '合理推断', '无法确认']
  const mapCard = renderTree(toolView({
    block: {
      meta: {
        kind: 'map',
        title: '主题契约样例',
        meta: { depth: 'map' },
        items: confidenceLabels.map((confidence, index) => ({ claim: `结论 ${index + 1}`, confidence })),
      },
    },
  }))
  const renderedText = textContent(mapCard)
  for (const label of confidenceLabels) {
    assert.match(renderedText, new RegExp(label), `confidence state keeps its visible ${label} label`)
  }
} finally {
  ctx.dispose()
  delete globalThis.__ModuleLoader__
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

console.log('CLIENT THEME CONTRACT: runtime CSS uses only official semantic tokens and no feature-owned theme colors')
