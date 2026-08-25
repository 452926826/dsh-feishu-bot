import test from 'node:test'
import assert from 'node:assert/strict'
import { DshHarnessBridge, userMessage } from '../lib/harness.js'

test('creates a core-compatible immutable user message', () => {
  const message = userMessage('hello')
  assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  assert.deepEqual(message, {
    id: message.id,
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  })
  assert.equal(Object.isFrozen(message), true)
  assert.equal(Object.isFrozen(message.content), true)
  assert.equal(Object.isFrozen(message.content[0]), true)
  assert.equal(Object.isFrozen(message.source), true)
})

test('binds approvals to the originating chat only while a conversation runs', async () => {
  const calls = []
  const events = []
  const agent = {
    session: { id: 'session-1', seq: 0, events },
    followup() {},
    async whenIdle() {
      events.push({
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'done' }] } },
      })
    },
  }
  const approvals = {
    bind(sessionId, chatId) {
      calls.push(`bind:${sessionId}:${chatId}`)
      return { dispose: () => calls.push(`dispose:${sessionId}:${chatId}`) }
    },
    respond(chatId, decision) { return `${chatId}:${decision}` },
  }
  const ctx = {
    agents: { get: () => agent },
    sessions: { async flush() {} },
  }
  const bridge = new DshHarnessBridge(ctx, '/projects', approvals)

  assert.equal(await bridge.converse('session-1', 'hello', 'chat-1'), 'done')
  assert.deepEqual(calls, ['bind:session-1:chat-1', 'dispose:session-1:chat-1'])
  assert.equal(bridge.respondToApproval('chat-1', 'reject'), 'chat-1:reject')
})
