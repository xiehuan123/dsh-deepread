import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPluginEntry } from './helpers/plugin-entry.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const plugin = await loadPluginEntry(root)

try {
  const holder = plugin.createContext()
  let registeredSkill
  let released = false

  holder.ctx.inject = (dependencies, callback) => {
    if (dependencies.length === 1 && dependencies[0] === 'skills') {
      const child = Object.create(holder.ctx)
      child.skills = {
        register(skill) {
          registeredSkill = skill
          return () => { released = true }
        },
      }
      callback(child)
    }
    return { dispose() {} }
  }

  plugin.module.apply(holder.ctx)

  assert.equal(registeredSkill?.name, 'dsh-deepread')
  assert.match(registeredSkill?.description ?? '', /Evidence-first deep reading/)
  assert.match(registeredSkill?.content ?? '', /^# DeepRead 精读/m)
  assert.equal(registeredSkill?.invocation?.modelInvocable, true)
  assert.equal(registeredSkill?.invocation?.userInvocable, true)
  assert.equal(registeredSkill?.resourceBase?.kind, 'directory')

  for (const dispose of holder.effects.splice(0).reverse()) await dispose()
  assert.equal(released, true, 'plugin disposal releases the packaged skill')

  console.log('PACKAGED SKILL: public Host apply registers and releases the tarball skill')
} finally {
  await plugin.cleanup()
}
