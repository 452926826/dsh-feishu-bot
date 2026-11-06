import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'
import { FeishuBot } from '../lib/feishu.js'

test('loads and disposes under real Cordis with stubbed host services and bot', async () => {
  const root = new Context()
  let route
  let disposed = false
  let starts = 0
  let stops = 0
  const originalStart = FeishuBot.prototype.start
  const originalStop = FeishuBot.prototype.stop
  const originalId = process.env.FEISHU_APP_ID
  const originalSecret = process.env.FEISHU_APP_SECRET
  process.env.FEISHU_APP_ID = 'smoke-app'
  process.env.FEISHU_APP_SECRET = 'smoke-secret'
  FeishuBot.prototype.start = function () { starts++ }
  FeishuBot.prototype.stop = async function () { stops++ }
  try {
    for (const name of plugin.inject) {
      await root.plugin(class extends Service {
        constructor(ctx) {
          super(ctx, name)
          if (name === 'webServer') this.register = value => { route = value; return () => { disposed = true } }
        }
      })
    }
    const fiber = await root.plugin(plugin)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(route.path, '/api/plugins/feishu-binding/status')
    assert.equal(starts, 1)
    await fiber.dispose()
    assert.equal(disposed, true)
    assert.equal(stops, 1)
  } finally {
    await root.fiber.dispose()
    FeishuBot.prototype.start = originalStart
    FeishuBot.prototype.stop = originalStop
    if (originalId === undefined) delete process.env.FEISHU_APP_ID
    else process.env.FEISHU_APP_ID = originalId
    if (originalSecret === undefined) delete process.env.FEISHU_APP_SECRET
    else process.env.FEISHU_APP_SECRET = originalSecret
  }
})
