import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('keeps DSH runtime packages as host-provided peers', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const bundledDshDependencies = Object.keys(packageJson.dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/'))
  assert.deepEqual(bundledDshDependencies, [])
  assert.equal(packageJson.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  assert.match(
    packageJson.peerDependencies['@deepseek-ai/dsh-host-webserver'],
    />=0\.1\.1-rc\.1 <0\.2\.0-0/,
  )
})

test('declares every client context service used by the settings bundle', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(new Set(packageJson.dsh.client.inject), new Set([
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
  ]))
})
