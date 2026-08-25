import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadCredentials,
  registrationErrorCode,
  removeCredentials,
  renderTerminalQr,
  saveCredentials,
  shouldRetryRegistration,
  validateCredentials,
  writeQrCode,
} from '../lib/registration.js'

test('validates credentials without exposing the returned tenant token', async () => {
  const seen = []
  await validateCredentials({ appId: 'cli_test', appSecret: 'secret' }, options => {
    seen.push(options)
    return {
      auth: { v3: { tenantAccessToken: { internal: async payload => {
        seen.push(payload.data)
        return { code: 0, data: { tenant_access_token: 'tenant-token', expire: 7200 } }
      } } } },
    }
  })
  assert.deepEqual(seen, [
    { appId: 'cli_test', appSecret: 'secret' },
    { app_id: 'cli_test', app_secret: 'secret' },
  ])

  await validateCredentials({ appId: 'cli_test', appSecret: 'secret' }, () => ({
    auth: { v3: { tenantAccessToken: { internal: async () => ({
      code: 0,
      msg: 'ok',
      tenant_access_token: 'runtime-top-level-token',
      expire: 7200,
    }) } } },
  }))

  await assert.rejects(
    validateCredentials({ appId: 'bad', appSecret: 'bad' }, () => ({
      auth: { v3: { tenantAccessToken: { internal: async () => ({ code: 10003, msg: 'invalid app' }) } } },
    })),
    /invalid app/u,
  )
})

test('classifies registration retry behavior', () => {
  assert.equal(registrationErrorCode({ code: 'expired_token' }), 'expired_token')
  assert.equal(shouldRetryRegistration({ code: 'expired_token' }, 99), true)
  assert.equal(shouldRetryRegistration({ code: 'access_denied' }, 1), false)
  assert.equal(shouldRetryRegistration({ code: 'abort' }, 1), false)
  assert.equal(shouldRetryRegistration(new Error('network'), 2), true)
  assert.equal(shouldRetryRegistration(new Error('network'), 3), false)
})

test('renders a terminal QR code', async () => {
  const rendered = await renderTerminalQr('https://open.feishu.cn/page/launcher?user_code=test')
  assert.match(rendered, /\x1b\[[0-9;]+m/u)
  assert.match(rendered, /▄▄▄▄▄▄▄/u)
  assert.ok(rendered.includes('\n'))
})

test('writes a valid PNG QR code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-qr-'))
  const path = join(directory, 'bind.png')
  await writeQrCode(path, 'https://accounts.feishu.cn/device?code=test')
  const bytes = await readFile(path)
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('stores and reloads credentials with owner-only mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-credentials-'))
  const path = join(directory, 'credentials.json')
  await saveCredentials(path, { appId: 'cli_test', appSecret: 'secret' }, {
    open_id: 'ou_test',
    tenant_brand: 'feishu',
  })
  assert.deepEqual(await loadCredentials(path), {
    appId: 'cli_test',
    appSecret: 'secret',
    ownerOpenId: 'ou_test',
  })
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('removes credentials idempotently for rebinding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-rebind-'))
  const path = join(directory, 'credentials.json')
  await saveCredentials(path, { appId: 'cli_test', appSecret: 'secret' })
  await removeCredentials(path)
  assert.equal(await loadCredentials(path), undefined)
  await removeCredentials(path)
})

test('returns undefined for a missing credentials file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-missing-'))
  assert.equal(await loadCredentials(join(directory, 'missing.json')), undefined)
})
