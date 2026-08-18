export function createRuntimeStub() {
  return {
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
  const slots = {
    inject(_name, provider) {
      return provider()
    },
    register(meta, component) {
      const handle = typeof meta.store === 'function' ? meta.store() : meta.store
      const instance = handle?.create()
      const injected = typeof meta.inject === 'function'
        ? meta.inject(...(instance === undefined ? [] : [instance.actions]))
        : {}
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
        registrations.delete(meta.name)
        instances.delete(meta.name)
      }
    },
  }
  return { slots, registrations, instances }
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
