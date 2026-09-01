import assert from 'node:assert/strict'
import test from 'node:test'
import { completionNotificationTargets } from '../lib/notifications.js'

test('does not notify a chat while another conversation is active there', () => {
  assert.deepEqual(
    completionNotificationTargets(new Set(['chat-active', 'chat-idle']), 'chat-source', new Set(['chat-active'])),
    new Set(['chat-idle', 'chat-source']),
  )
})

test('always keeps the originating chat in completion targets', () => {
  assert.deepEqual(completionNotificationTargets(new Set(), 'chat-source', new Set()), new Set(['chat-source']))
})
