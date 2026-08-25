#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as lark from '@larksuiteoapi/node-sdk'

const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
const path = process.env.FEISHU_CREDENTIALS_PATH ?? join(home, 'feishu-bot', 'credentials.json')
const credentials = JSON.parse(await readFile(path, 'utf8'))
let received = false

const dispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async data => {
    received = true
    const message = data?.message
    console.log(JSON.stringify({
      stage: 'event-received',
      messageType: message?.message_type ?? null,
      hasChatId: typeof message?.chat_id === 'string',
      hasMessageId: typeof message?.message_id === 'string',
      hasSenderOpenId: typeof data?.sender?.sender_id?.open_id === 'string',
      ownerMatches: typeof credentials.userOpenId === 'string' && data?.sender?.sender_id?.open_id === credentials.userOpenId,
    }))
  },
})

const ws = new lark.WSClient({
  appId: credentials.appId,
  appSecret: credentials.appSecret,
  loggerLevel: lark.LoggerLevel.info,
  onReady: () => console.log(JSON.stringify({ stage: 'ws-ready' })),
  onError: error => console.log(JSON.stringify({ stage: 'ws-error', message: String(error) })),
})

await ws.start({ eventDispatcher: dispatcher })
console.log(JSON.stringify({ stage: 'listening', timeoutSeconds: 90 }))
setTimeout(() => {
  console.log(JSON.stringify({ stage: 'result', received }))
  process.exit(received ? 0 : 2)
}, 90_000)
