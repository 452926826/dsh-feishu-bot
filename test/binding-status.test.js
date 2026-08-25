import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { maskIdentifier, readBindingView } from '../lib/binding-status.js'

test('returns a QR view without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-status-'))
  const qrPath = join(root, 'qr.png')
  await writeFile(qrPath, Buffer.from([137, 80, 78, 71]))
  const view = await readBindingView({ credentialsPath: join(root, 'credentials.json'), qrPath, websocket: 'connecting' })
  assert.equal(view.state, 'waiting')
  assert.match(view.qrDataUrl, /^data:image\/png;base64,/u)
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

test('masks short identifiers', () => {
  assert.equal(maskIdentifier('abc'), 'ab***')
})
