import test from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalCoordinator, handleApprovalRequest } from '../lib/approval.js'

test('routes an approval to the originating chat and allows it once', async () => {
  const sent = []
  const approvals = new ApprovalCoordinator(async (chatId, text) => sent.push({ chatId, text }))
  const route = approvals.bind('session-1', 'chat-1')

  const pending = approvals.request({
    sessionId: 'session-1',
    toolName: 'bash',
    reason: '需要写入工作区',
    arguments: '{"command":"npm install"}',
  })
  await Promise.resolve()

  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, 'chat-1')
  assert.match(sent[0].text, /bash/u)
  assert.match(sent[0].text, /npm install/u)
  assert.equal(approvals.respond('chat-1', 'approve'), '已批准本次操作。')
  assert.equal(await pending, 'allowed-once')
  assert.equal(approvals.respond('chat-1', 'approve'), '当前没有待审批操作。')
  route.dispose()
})

test('rejects only the pending approval for that chat', async () => {
  const approvals = new ApprovalCoordinator(async () => undefined)
  const firstRoute = approvals.bind('session-1', 'chat-1')
  const secondRoute = approvals.bind('session-2', 'chat-2')
  const first = approvals.request({ sessionId: 'session-1', toolName: 'bash' })
  const second = approvals.request({ sessionId: 'session-2', toolName: 'edit' })
  await Promise.resolve()

  assert.equal(approvals.respond('chat-1', 'reject'), '已拒绝本次操作。')
  assert.equal(await first, 'rejected')
  assert.equal(approvals.respond('chat-1', 'reject'), '当前没有待审批操作。')
  assert.equal(approvals.respond('chat-2', 'approve'), '已批准本次操作。')
  assert.equal(await second, 'allowed-once')
  firstRoute.dispose()
  secondRoute.dispose()
})

test('adapts a Harness approval request with its tool arguments', async () => {
  const sent = []
  const approvals = new ApprovalCoordinator(async (_chatId, text) => sent.push(text))
  approvals.bind('session-1', 'chat-1')
  const request = {
    agent: {
      session: {
        id: 'session-1',
        events: [{
          type: 'tool/call',
          data: { callId: 'call-1', name: 'bash', arguments: '{"command":"npm install"}' },
        }],
      },
    },
    toolName: 'bash',
    callId: 'call-1',
    reason: 'needs network',
  }
  let nextCalls = 0
  const pending = handleApprovalRequest(approvals, request, async () => {
    nextCalls++
    return 'unavailable'
  })
  await Promise.resolve()

  assert.match(sent[0], /npm install/u)
  approvals.respond('chat-1', 'approve')
  assert.equal(await pending, 'allowed-once')
  assert.equal(nextCalls, 0)
})

test('does not let a second chat steal an active session route', async () => {
  const approvals = new ApprovalCoordinator(async () => undefined)
  const first = approvals.bind('session-1', 'chat-1')
  const second = approvals.bind('session-1', 'chat-2')
  const pending = approvals.request({ sessionId: 'session-1', toolName: 'bash' })
  await Promise.resolve()

  assert.equal(approvals.respond('chat-2', 'approve'), '当前没有待审批操作。')
  assert.equal(approvals.respond('chat-1', 'reject'), '已拒绝本次操作。')
  assert.equal(await pending, 'rejected')
  second.dispose()
  first.dispose()
})

test('passes approvals without a Feishu route to the next answerer', async () => {
  const approvals = new ApprovalCoordinator(async () => undefined)
  const outcome = await handleApprovalRequest(approvals, {
    agent: { session: { id: 'other-session', events: [] } },
    toolName: 'edit',
  }, async () => 'rejected')
  assert.equal(outcome, 'rejected')
})
