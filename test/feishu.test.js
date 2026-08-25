import test from 'node:test'
import assert from 'node:assert/strict'
import { isSenderAllowed, runWithThinkingMessage, splitText } from '../lib/feishu.js'

test('sender access defaults to the QR owner or an explicitly allowed chat', () => {
  const chats = new Set(['oc_allowed'])
  const users = new Set(['ou_owner'])
  assert.equal(isSenderAllowed('oc_other', 'ou_owner', chats, users), true)
  assert.equal(isSenderAllowed('oc_allowed', 'ou_other', chats, users), true)
  assert.equal(isSenderAllowed('oc_other', 'ou_other', chats, users), false)
  assert.equal(isSenderAllowed('oc_other', undefined, new Set(), new Set()), true)
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
