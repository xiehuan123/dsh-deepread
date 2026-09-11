import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createRuntimeStub } from './helpers/client-runtime.mjs'
import { clientSmokeHost } from './helpers/client-smoke-host.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
let handoff
vm.runInNewContext(bundle, { window: { __ModuleLoader__: { load(value) { handoff = value } } } })

// Only these platform identities are consumed by DeepRead on Harness 0.1.2-rc.1.
// Do not seed the removed runtime/client facade: that hid issue #10.
const staticModules = { react: {}, '@deepseek-ai/dsh-client-store': createRuntimeStub() }
const requested = []
const plugin = handoff.factory((specifier) => {
  requested.push(specifier)
  assert.ok(Object.hasOwn(staticModules, specifier), `client-modules: require("${specifier}") missed the module table`)
  return staticModules[specifier]
})
assert.equal(typeof plugin.apply, 'function')
assert.deepEqual(requested.sort(), Object.keys(staticModules).sort())

const upstreamRoot = clientSmokeHost('CLIENT PLATFORM REAL LOADER', [
  'packages/client/modules/lib/types/client/system.js',
  'packages/client/web/src/platform.ts',
])
if (upstreamRoot !== null) {
  const systemPath = join(upstreamRoot, 'packages/client/modules/lib/types/client/system.js')
  // Read the current upstream platform source, not an invented compatibility shim.
  const { PLATFORM_MODULES } = await import(pathToFileURL(join(upstreamRoot, 'packages/client/web/src/platform.ts')).href)
  for (const specifier of requested) assert.ok(PLATFORM_MODULES.includes(specifier), `${specifier} is an upstream platform seed`)
  const { ClientModuleSystem } = await import(pathToFileURL(systemPath).href)
  const previousWindow = globalThis.window
  globalThis.window = globalThis
  try {
    const system = new ClientModuleSystem({
      modules: [{ id: 'dsh-deepread', url: pathToFileURL(join(root, 'lib/client.js')).href, rev: 'platform-test' }],
      staticModules,
      loadBundle: (url) => import(url),
    })
    assert.equal(typeof (await system.import('dsh-deepread')).apply, 'function')
  } finally {
    delete globalThis.__ModuleLoader__
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  console.log('CLIENT PLATFORM: real Harness loader accepts the bundle with current platform seeds')
}
console.log('CLIENT PLATFORM: no removed runtime facade or undeclared module requests')
