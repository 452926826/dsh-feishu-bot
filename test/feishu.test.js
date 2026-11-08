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

test('posts replies as interactive cards', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  const sent = []
  bot.client.im.message.create = async payload => { sent.push(payload); return { data: { message_id: 'om_card' } } }
  await bot.sendOne('oc_chat', '**粗体** 与 `code`')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.msg_type, 'interactive')
  const card = JSON.parse(sent[0].data.content)
  assert.equal(card.elements[0].tag, 'markdown')
  assert.equal(card.elements[0].text_size, 'normal')
})

test('falls back to plain text when a card is rejected', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  const attempts = []
  bot.client.im.message.create = async payload => {
    attempts.push(payload.data.msg_type)
    if (payload.data.msg_type === 'interactive') throw new Error('card rejected')
    return { data: { message_id: 'om_text' } }
  }
  const id = await bot.sendOne('oc_chat', 'hello')
  assert.deepEqual(attempts, ['interactive', 'text'])
  assert.equal(id, 'om_text')
})

test('patches the thinking placeholder instead of posting a second message', async () => {
  const bot = new FeishuBot({ appId: 'cli_test', appSecret: 'secret', allowedChats: new Set(), allowedUsers: new Set(), onMessage: async () => '', onError: () => {} })
  const patches = []
  bot.client.im.message.patch = async payload => { patches.push(payload) }
  bot.client.im.message.create = async () => { throw new Error('should not create') }
  await bot.update('om_thinking', 'oc_chat', 'final answer')
  assert.equal(patches.length, 1)
  assert.equal(patches[0].path.message_id, 'om_thinking')
})
