import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadCredentials,
  registerByQrCode,
  registrationErrorCode,
  removeCredentials,
  renderTerminalQr,
  saveCredentials,
  saveRegistrationQr,
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

test('registration QR logs do not reveal the link or image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-qr-log-'))
  const path = join(directory, 'bind.png')
  const messages = []
  const logger = { info: text => messages.push(text), warn: text => messages.push(text) }
  const url = 'https://example.invalid/device?token=private-value'
  await saveRegistrationQr(path, url, logger)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(messages.length, 1)
  assert.equal(messages.join('').includes('private-value'), false)
  assert.equal(messages.join('').includes('example.invalid'), false)
  await saveRegistrationQr(join(directory, 'missing', '..', 'bind.png', 'bad'), url, logger)
  assert.equal(messages.at(-1), 'failed to write Feishu QR code')
})

for (const fail of [false, true]) {
  test(`registration ${fail ? 'failure' : 'success'} waits for queued QR writes before cleanup`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-feishu-qr-race-'))
    const path = join(directory, 'qr.png')
    const order = []
    let release
    const gate = new Promise(resolve => { release = resolve })
    const pending = registerByQrCode({
      credentialsPath: join(directory, 'credentials.json'), qrPath: path,
      logger: { info() {}, warn() {} },
      registerApp: async options => {
        options.onQRCodeReady({ url: 'first', expireIn: 60 })
        options.onQRCodeReady({ url: 'second', expireIn: 60 })
        if (fail) throw new Error('registration failed')
        return { client_id: 'cli_test', client_secret: 'test-secret' }
      },
      writeQr: async (target, url) => {
        order.push(`start:${url}`)
        if (url === 'first') await gate
        await writeFile(target, url)
        order.push(`end:${url}`)
      },
      validate: async () => {},
    })
    const observed = pending.then(() => 'success', () => 'failure')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(order, ['start:first'])
    release()
    assert.equal(await observed, fail ? 'failure' : 'success')
    assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second'])
    await assert.rejects(stat(path), { code: 'ENOENT' })
  })
}

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
