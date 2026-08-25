import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('client bundle registers the package with ModuleLoader', async () => {
  const registrations = []
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration)
        },
      },
    },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-feishu-bot')
  assert.equal(typeof registrations[0].factory, 'function')
})

test('client plugin declares Cordis service injection', async () => {
  const registrations = []
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: registration => registrations.push(registration) } },
  })
  const plugin = registrations[0].factory(specifier => {
    if (specifier === 'react') return {}
    throw new Error(`unexpected external: ${specifier}`)
  })
  assert.deepEqual(Array.from(plugin.inject ?? []), ['locale', 'slots'])
  assert.equal(typeof plugin.apply, 'function')
})
