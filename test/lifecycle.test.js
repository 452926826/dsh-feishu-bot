import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../lib/index.js'
import { FeishuBot } from '../lib/feishu.js'

test('loads and disposes under real Cordis with stubbed host services and bot', async () => {
  const root = new Context()
  let route
  let disposed = false
  let starts = 0
  let stops = 0
  let allowedUsers
  let rejection = 401
  const rootDir = await mkdtemp(join(tmpdir(), 'feishu-lifecycle-'))
  const envNames = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_ALLOWED_USERS', 'FEISHU_QR_PATH', 'FEISHU_CREDENTIALS_PATH']
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
  process.env.FEISHU_ALLOWED_USERS = 'ou_test, ou_second'
  process.env.FEISHU_QR_PATH = join(rootDir, 'qr.png')
  process.env.FEISHU_CREDENTIALS_PATH = join(rootDir, 'missing.json')
  await writeFile(process.env.FEISHU_QR_PATH, 'secret-qr-bytes')
  const originalStart = FeishuBot.prototype.start
  const originalStop = FeishuBot.prototype.stop
  process.env.FEISHU_APP_ID = 'smoke-app'
  process.env.FEISHU_APP_SECRET = 'smoke-secret'
  FeishuBot.prototype.start = function () { starts++; allowedUsers = this.options.allowedUsers }
  FeishuBot.prototype.stop = async function () { stops++ }
  try {
    for (const name of plugin.inject) {
      await root.plugin(class extends Service {
        constructor(ctx) {
          super(ctx, name)
          if (name === 'webServer') this.register = value => { route = value; return () => { disposed = true } }
          if (name === 'connection') this.requestRejection = () => { if (rejection === 'error') throw new Error('auth failure'); return rejection }
        }
      })
    }
    const fiber = await root.plugin(plugin)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(route.path, '/api/plugins/feishu-binding/status')
    assert.equal(starts, 1)
    assert.deepEqual([...allowedUsers], ['ou_test', 'ou_second'])
    delete process.env.FEISHU_APP_ID
    delete process.env.FEISHU_APP_SECRET
    let body = ''
    const response = { statusCode: 0, setHeader() {}, end(value = '') { body = value } }
    await route.handler({ method: 'GET' }, response)
    assert.equal(response.statusCode, 401)
    assert.equal(body, '')
    rejection = 403
    await route.handler({ method: 'GET' }, response)
    assert.equal(response.statusCode, 403)
    rejection = 'error'
    await route.handler({ method: 'GET' }, response)
    assert.equal(response.statusCode, 503)
    assert.equal(body, '')
    rejection = undefined
    await route.handler({ method: 'GET' }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(body).state, 'waiting')
    assert.equal('qrDataUrl' in JSON.parse(body), false)
    assert.equal(body.includes('secret-qr-bytes'), false)
    assert.equal(body.includes(Buffer.from('secret-qr-bytes').toString('base64')), false)
    await fiber.dispose()
    assert.equal(disposed, true)
    assert.equal(stops, 1)
  } finally {
    await root.fiber.dispose()
    FeishuBot.prototype.start = originalStart
    FeishuBot.prototype.stop = originalStop
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name]
      else process.env[name] = originalEnv[name]
    }
  }
})
