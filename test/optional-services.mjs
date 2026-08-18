import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const plugin = await loadPluginEntry(root)

async function disposeAll(effects) {
  for (const dispose of effects.splice(0).reverse()) await dispose()
}

function createLifecycleContext() {
  const holder = plugin.createContext()
  const services = new Map()
  const injections = new Set()

  async function deactivate(binding) {
    if (binding.effects === null) return
    const effects = binding.effects
    binding.effects = null
    for (const dispose of effects.splice(0).reverse()) await dispose()
  }

  function sync(binding) {
    const ready = binding.dependencies.every((name) => services.has(name))
    if (!ready) return deactivate(binding)
    if (binding.effects !== null) return
    const childEffects = []
    const child = Object.create(holder.ctx)
    child.effect = (register) => {
      const dispose = register()
      if (typeof dispose === 'function') childEffects.push(dispose)
      return dispose
    }
    for (const name of binding.dependencies) child[name] = services.get(name)
    binding.effects = childEffects
    binding.callback(child)
  }

  holder.ctx.get = (name) => services.get(name)
  holder.ctx.inject = (dependencies, callback) => {
    const binding = { dependencies, callback, effects: null }
    injections.add(binding)
    sync(binding)
    const fiber = {
      dispose() {
        deactivate(binding)
        injections.delete(binding)
      },
    }
    holder.effects.push(() => fiber.dispose())
    return fiber
  }

  return {
    ctx: holder.ctx,
    get tool() { return holder.tool },
    async provide(name, service) {
      services.set(name, service)
      for (const binding of injections) await sync(binding)
    },
    async remove(name) {
      services.delete(name)
      for (const binding of injections) await sync(binding)
    },
    dispose: () => disposeAll(holder.effects),
  }
}

function createStorageDomain() {
  const handles = []
  const tables = new Map()
  return {
    handles,
    async open(spec) {
      const records = tables.get(spec.name) ?? new Map()
      tables.set(spec.name, records)
      const handle = {
        name: spec.name,
        closed: false,
        table: () => ({
          get: (key) => records.get(key),
          put: async (key, value) => records.set(key, value),
          delete: async (key) => records.delete(key),
          entries: () => records.entries(),
        }),
        async close() { handle.closed = true },
      }
      handles.push(handle)
      return handle
    },
  }
}

function createWebServer() {
  const routes = new Set()
  return {
    routes,
    register(route) {
      routes.add(route)
      return () => routes.delete(route)
    },
  }
}

try {
  const { module: mod } = plugin
  for (const service of ['webServer', 'storageDomain', 'jobs']) {
    assert.ok(!mod.inject.includes(service), `headless activation must not require ${service}`)
  }

  const holder = plugin.createContext({
    modelResult: {
      title: 'Headless pasted text',
      summary: 'summary',
      thesis: 'thesis',
      arguments: [],
      quotes: [],
      concepts: [],
      questions: [],
    },
  })
  mod.apply(holder.ctx)
  assert.equal(holder.tool?.name, 'deepread', 'headless activation registers the public tool')

  const result = await holder.tool.execute({
    text: '这是一段无需 Web 服务即可完成精读的粘贴文本。',
    depth: 'quick',
    export: 'none',
  }, {})
  assert.equal(result.kind, 'article')
  assert.equal(result.title, 'Headless pasted text')
  await disposeAll(holder.effects)

  const lifecycle = createLifecycleContext()
  mod.apply(lifecycle.ctx)
  const firstWebServer = createWebServer()
  await lifecycle.provide('webServer', firstWebServer)
  assert.equal(firstWebServer.routes.size, 1, 'late webServer arrival registers the budget route')
  assert.equal([...firstWebServer.routes][0].path, '/api/deepread/budget')

  await lifecycle.remove('webServer')
  assert.equal(firstWebServer.routes.size, 0, 'webServer unload releases the old route')

  const replacementWebServer = createWebServer()
  await lifecycle.provide('webServer', replacementWebServer)
  assert.equal(replacementWebServer.routes.size, 1, 'webServer reload registers one replacement route')
  assert.equal(firstWebServer.routes.size, 0, 'webServer reload does not revive the old route')

  await lifecycle.dispose()
  assert.equal(replacementWebServer.routes.size, 0, 'plugin unload releases the replacement route')
  assert.equal(lifecycle.tool, null, 'plugin unload releases the deepread tool')

  const storageLifecycle = createLifecycleContext()
  await storageLifecycle.provide('web', {
    fetch: async ({ url }) => ({
      statusCode: 200,
      body: { kind: 'html', content: `<html><body><p>${url} 的正文内容。</p></body></html>` },
    }),
  })
  storageLifecycle.ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify({
      title: 'Storage lifecycle', summary: 'summary', thesis: 'thesis',
      arguments: [], quotes: [], concepts: [], questions: [],
    }) }
    yield { type: 'finish', reason: null }
  }
  mod.apply(storageLifecycle.ctx)

  await storageLifecycle.tool.execute({
    url: 'https://mp.weixin.qq.com/s/memory-first', depth: 'quick', export: 'none',
  }, {})

  const firstStorage = createStorageDomain()
  await storageLifecycle.provide('storageDomain', firstStorage)
  await storageLifecycle.tool.execute({
    url: 'https://mp.weixin.qq.com/s/persistent-second', depth: 'quick', export: 'none',
  }, {})
  assert.deepEqual(
    firstStorage.handles.map((handle) => handle.name).sort(),
    ['deepread_stats', 'deepread_url_cache'],
    'late storageDomain arrival opens both existing persistence domains',
  )

  await storageLifecycle.remove('storageDomain')
  assert.ok(firstStorage.handles.every((handle) => handle.closed), 'storageDomain unload closes all old handles')

  const replacementStorage = createStorageDomain()
  await storageLifecycle.provide('storageDomain', replacementStorage)
  await storageLifecycle.tool.execute({
    url: 'https://mp.weixin.qq.com/s/persistent-third', depth: 'quick', export: 'none',
  }, {})
  assert.deepEqual(
    replacementStorage.handles.map((handle) => handle.name).sort(),
    ['deepread_stats', 'deepread_url_cache'],
    'storageDomain reload opens fresh handles without reviving old ones',
  )

  await storageLifecycle.dispose()
  assert.ok(replacementStorage.handles.every((handle) => handle.closed), 'plugin unload closes replacement domain handles')

  const failingWebLifecycle = createLifecycleContext()
  await failingWebLifecycle.provide('webServer', {
    register() { throw new Error('web route registry unavailable') },
  })
  assert.doesNotThrow(
    () => mod.apply(failingWebLifecycle.ctx),
    'a Web-only route failure must not block Host activation',
  )
  assert.equal(failingWebLifecycle.tool?.name, 'deepread')
  await failingWebLifecycle.dispose()

  const jobsLifecycle = createLifecycleContext()
  jobsLifecycle.ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify({
      title: 'Jobs lifecycle', summary: 'summary', thesis: 'thesis',
      arguments: [], quotes: [], concepts: [], questions: [],
    }) }
    yield { type: 'finish', reason: null }
  }
  mod.apply(jobsLifecycle.ctx, { backgroundMinChars: 10 })
  const longText = '需要转后台的精读文本。'.repeat(10)
  const withoutJobs = await jobsLifecycle.tool.execute({ text: longText, depth: 'deep', export: 'none' }, {})
  assert.equal(withoutJobs.kind, 'article', 'missing jobs falls back to synchronous tool execution')

  await jobsLifecycle.provide('jobs', { start: async () => 'late-job' })
  const withLateJobs = await jobsLifecycle.tool.execute({ text: longText, depth: 'deep', export: 'none' }, {})
  assert.equal(withLateJobs.kind, 'background')
  assert.equal(withLateJobs.jobId, 'late-job')

  await jobsLifecycle.remove('jobs')
  const afterJobsUnload = await jobsLifecycle.tool.execute({ text: longText, depth: 'deep', export: 'none' }, {})
  assert.equal(afterJobsUnload.kind, 'article', 'jobs unload restores synchronous fallback')

  await jobsLifecycle.provide('jobs', { start: async () => 'replacement-job' })
  const afterJobsReload = await jobsLifecycle.tool.execute({ text: longText, depth: 'deep', export: 'none' }, {})
  assert.equal(afterJobsReload.jobId, 'replacement-job')
  await jobsLifecycle.dispose()
} finally {
  await plugin.cleanup()
}

console.log('OPTIONAL SERVICES 5/5: optional-service lifecycle and fallback matrix pass')
