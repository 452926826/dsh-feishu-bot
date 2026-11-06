import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { maskIdentifier, readBindingView } from '../lib/binding-status.js'

test('reports waiting without exposing the QR image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-status-'))
  const qrPath = join(root, 'qr.png')
  await writeFile(qrPath, Buffer.from([137, 80, 78, 71]))
  const view = await readBindingView({ credentialsPath: join(root, 'credentials.json'), qrPath, websocket: 'connecting' })
  assert.equal(view.state, 'waiting')
  assert.equal('qrDataUrl' in view, false)
  assert.equal(JSON.stringify(view).includes('iVBORw'), false)
  assert.equal(view.websocket, 'connecting')
})

test('returns masked bound information without secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-status-'))
  const credentialsPath = join(root, 'credentials.json')
  await writeFile(credentialsPath, JSON.stringify({
    appId: 'cli_1234567890',
    appSecret: 'must-not-appear',
    userOpenId: 'ou_1234567890',
    tenantBrand: 'Example tenant',
    createdAt: '2026-01-02T03:04:05.000Z',
  }), { mode: 0o600 })
  const view = await readBindingView({ credentialsPath, qrPath: join(root, 'qr.png'), websocket: 'connected' })
  assert.deepEqual(view, {
    state: 'bound',
    appIdMasked: 'cli_12...7890',
    ownerOpenIdMasked: 'ou_123...7890',
    tenantBrand: 'Example tenant',
    boundAt: '2026-01-02T03:04:05.000Z',
    websocket: 'connected',
  })
  assert.equal(JSON.stringify(view).includes('must-not-appear'), false)
})

test('environment credentials override saved credentials, including malformed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-status-'))
  const credentialsPath = join(root, 'credentials.json')
  await writeFile(credentialsPath, '{invalid json')
  const view = await readBindingView({ credentialsPath, qrPath: join(root, 'qr.png'), websocket: 'connected', environmentCredentials: { appId: 'cli_environment', appSecret: 'test-secret' } })
  assert.equal(view.state, 'bound')
  assert.equal(view.appIdMasked, 'cli_en...ment')
  assert.equal(view.boundAt, 'environment')
  await writeFile(credentialsPath, JSON.stringify({ appId: 'cli_incomplete' }))
  assert.equal((await readBindingView({ credentialsPath, qrPath: join(root, 'qr.png'), websocket: 'disconnected' })).state, 'unavailable')
})

test('masks short identifiers', () => {
  assert.equal(maskIdentifier('abc'), 'ab***')
})
