export function createRuntimeStub() {
  return {
    createSnapshotStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        update(mutator) {
          const next = { ...state }
          mutator(next)
          state = next
          for (const listener of listeners) listener()
        },
        set(next) {
          state = next
          for (const listener of listeners) listener()
        },
        listenerCount: () => listeners.size,
      }
    },
    defineStore(spec) {
      return {
        create() {
          const state = spec.init()
          const listeners = new Set()
          const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [
            name,
            (...args) => {
              action(state, ...args)
              for (const listener of listeners) listener()
            },
          ]))
          return {
            actions,
            getSnapshot: () => state,
            subscribe(listener) {
              listeners.add(listener)
              return () => listeners.delete(listener)
            },
            listenerCount: () => listeners.size,
          }
        },
      }
    },
  }
}

export function createSlotHarness() {
  const registrations = new Map()
  const instances = new Map()
  const hookSources = []
  const injections = new Map()
  const slots = {
    inject(name, provider) {
      let activeDispose
      const mount = () => {
        if (activeDispose === undefined) activeDispose = provider()
      }
      const collapse = () => {
        const dispose = activeDispose
        activeDispose = undefined
        if (typeof dispose === 'function') dispose()
      }
      const controller = { mount, collapse }
      injections.set(name, controller)
      mount()
      return () => {
        collapse()
        if (injections.get(name) === controller) injections.delete(name)
      }
    },
    register(meta, component) {
      const handle = typeof meta.store === 'function' ? meta.store() : meta.store
      const instance = handle?.create()
      const injectedFace = typeof meta.inject === 'function'
        ? meta.inject(...(instance === undefined ? [] : [instance.actions]))
        : {}
      const injected = { ...injectedFace }
      const hookDisposers = []
      for (const [name, source] of Object.entries(injectedFace.hooks ?? {})) {
        const hookName = `use${name[0].toUpperCase()}${name.slice(1)}`
        injected[hookName] = (selector) => selector(source.getSnapshot())
        hookSources.push(source)
        hookDisposers.push(source.subscribe(() => {}))
      }
      delete injected.hooks
      const wrapped = (owner = {}) => ({
        type: component,
        props: {
          ...owner,
          ...injected,
          ...(instance === undefined ? {} : {
            useStore: (selector) => selector(instance.getSnapshot()),
            actions: instance.actions,
          }),
        },
      })
      registrations.set(meta.name, wrapped)
      if (instance !== undefined) instances.set(meta.name, instance)
      return () => {
        for (const disposeHook of hookDisposers.splice(0).reverse()) disposeHook()
        registrations.delete(meta.name)
        instances.delete(meta.name)
      }
    },
  }
  return {
    slots,
    registrations,
    instances,
    hookSources,
    collapseSlot(name) { injections.get(name)?.collapse() },
    declareSlot(name) { injections.get(name)?.mount() },
  }
}

export function createEffectContext(base) {
  const disposers = []
  return {
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
      for (const disposer of disposers.splice(0).reverse()) disposer()
    },
  }
}
