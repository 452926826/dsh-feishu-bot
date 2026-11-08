import test from 'node:test'
import assert from 'node:assert/strict'
import { FeishuBot, isSenderAllowed, runWithThinkingMessage, splitText } from '../lib/feishu.js'

test('sender access requires an allowed user and any configured chat restriction', () => {
  const chats = new Set(['oc_allowed'])
  const users = new Set(['ou_owner'])
  assert.equal(isSenderAllowed('oc_allowed', 'ou_owner', chats, users), true)
  assert.equal(isSenderAllowed('oc_other', 'ou_owner', chats, users), false)
  assert.equal(isSenderAllowed('oc_allowed', 'ou_other', chats, users), false)
  assert.equal(isSenderAllowed('oc_allowed', undefined, chats, users), false)
  assert.equal(isSenderAllowed('oc_allowed', 'ou_owner', chats, new Set()), false)
  assert.equal(isSenderAllowed('oc_other', 'ou_owner', new Set(), users), true)
  assert.equal(isSenderAllowed('oc_other', undefined, new Set(), new Set()), false)
})

test('splitText preserves short messages', () => {
  assert.deepEqual(splitText('hello', 10), ['hello'])
})

test('splitText prefers newline boundaries and preserves content', () => {
  const input = '12345\n67890\nabcde'
  const chunks = splitText(input, 11)
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 11))
  assert.equal(chunks.join('\n'), input)
})

test('splitText keeps Unicode code points intact', () => {
  assert.deepEqual(splitText('😀😀😀', 2), ['😀😀', '😀'])
})

test('formats completion notifications with a bare /uc hint', () => {
  const text = '对话已完成：demo\nanswer\n\n回复 /uc 可直接进入最近完成的对话。'
  assert.match(text, /回复 \/uc/u)
})

test('shows a thinking message and replaces it with the reply', async () => {
  const calls = []
  await runWithThinkingMessage({
    sendThinking: async () => { calls.push('thinking'); return 'om_thinking' },
    onMessage: async () => { calls.push('process'); return 'answer' },
    update: async (id, text) => { calls.push(`update:${id}:${text}`) },
    send: async text => { calls.push(`send:${text}`) },
    onError: error => { calls.push(`error:${String(error)}`) },
  })
  assert.deepEqual(calls, ['thinking', 'process', 'update:om_thinking:answer'])
})

test('falls back to a new reply if the thinking message cannot be updated', async () => {
  const calls = []
  await runWithThinkingMessage({
    sendThinking: async () => 'om_thinking',
    onMessage: async () => 'answer',
    update: async () => { throw new Error('update failed') },
    send: async text => { calls.push(`send:${text}`) },
    onError: error => { calls.push(`error:${error.message}`) },
  })
  assert.deepEqual(calls, ['error:update failed', 'send:answer'])
})

test('parses plain text messages', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  const parsed = await bot.parseMessage('text', JSON.stringify({ text: '  hello  ' }), 'om_1')
  assert.deepEqual(parsed, { text: 'hello', images: [] })
})

test('parses rich-post messages into text and image attachments', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  bot.downloadImage = async (_messageId, key) => ({ data: 'AAAA', mediaType: 'image/png', name: `${key}.png` })
  const post = JSON.stringify({
    zh_cn: {
      title: '标题',
      content: [
        [{ tag: 'text', text: '看这个' }, { tag: 'img', image_key: 'img_v3_1' }],
        [{ tag: 'a', text: '链接', href: 'https://example.com' }],
      ],
    },
  })
  const parsed = await bot.parseMessage('post', post, 'om_2')
  assert.equal(parsed.text, '标题\n看这个\n链接 (https://example.com)')
  assert.equal(parsed.images.length, 1)
  assert.equal(parsed.images[0].name, 'img_v3_1.png')
})

test('parses image messages into one attachment', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  bot.downloadImage = async () => ({ data: 'BBBB', mediaType: 'image/jpeg', name: 'photo.jpg' })
  const parsed = await bot.parseMessage('image', JSON.stringify({ image_key: 'img_v3_2' }), 'om_3')
  assert.equal(parsed.text, '')
  assert.equal(parsed.images.length, 1)
  assert.equal(parsed.images[0].mediaType, 'image/jpeg')
})

test('parses file messages into a readable local path', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  bot.downloadFile = async () => ({ name: 'notes.md', size: 12, path: '/tmp/feishu-inbound/notes.md' })
  const parsed = await bot.parseMessage('file', JSON.stringify({ file_key: 'file_1', file_name: 'notes.md' }), 'om_4')
  assert.match(parsed.text, /^\[用户发来文件\] notes\.md（12 字节）/u)
  assert.match(parsed.text, /本地路径：\/tmp\/feishu-inbound\/notes\.md/u)
})

test('unsupported message types parse to nothing', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  const parsed = await bot.parseMessage('audio', JSON.stringify({}), 'om_5')
  assert.deepEqual(parsed, { text: '', images: [] })
})
