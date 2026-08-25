import test from 'node:test'
import assert from 'node:assert/strict'
import { FeishuCommandController } from '../lib/controller.js'

class MemoryStore {
  values = new Map()
  async get(id) { return { ...(this.values.get(id) ?? {}) } }
  async set(id, value) { this.values.set(id, { ...value }) }
}

function fixture() {
  const projects = [{ id: 'p1', name: 'alpha', path: '/projects/alpha' }]
  const conversations = [{ id: 'c1', name: 'first chat' }, { id: 'c2', name: 'second chat' }]
  const bridge = {
    async listProjects() { return projects },
    async createProject(name) {
      const project = { id: `p${projects.length + 1}`, name, path: `/projects/${name}` }
      projects.push(project)
      return project
    },
    async listConversations(projectId) {
      assert.equal(projectId, 'p1')
      return conversations
    },
    async createConversation(projectId) {
      assert.equal(projectId, 'p1')
      const conversation = { id: 'c3', name: 'new chat' }
      conversations.push(conversation)
      return conversation
    },
    async recentMessages(id, count) {
      assert.equal(id, 'c2')
      assert.equal(count, 2)
      return ['你：hello', 'Harness：world']
    },
    async converse(id, text) { return `${id}:${text}` },
    respondToApproval(chatId, decision) { return `${chatId}:${decision}` },
  }
  const store = new MemoryStore()
  return { controller: new FeishuCommandController(bridge, store), store }
}

test('lists projects with one-based display', async () => {
  const { controller } = fixture()
  assert.equal((await controller.handle('chat', '/lp')).text, '1，alpha')
})

test('selects project and conversation and returns two history messages', async () => {
  const { controller, store } = fixture()
  assert.equal((await controller.handle('chat', '/up + alpha')).text, '已进入项目：alpha')
  assert.equal((await controller.handle('chat', '/lc')).text, '1，first chat\n2，second chat')
  assert.equal(
    (await controller.handle('chat', '/uc + 2')).text,
    '已进入对话：second chat\n最近 2 条记录：\n你：hello\nHarness：world',
  )
  assert.deepEqual(await store.get('chat'), { projectId: 'p1', conversationId: 'c2' })
  assert.equal((await controller.handle('chat', 'continue')).text, 'c2:continue')
})

test('creates project and conversation and updates selection', async () => {
  const { controller, store } = fixture()
  assert.equal((await controller.handle('chat', '/np + beta')).text, '已创建并进入项目：beta')
  assert.deepEqual(await store.get('chat'), { projectId: 'p2' })

  await controller.handle('other', '/up + alpha')
  assert.equal((await controller.handle('other', '/nc')).text, '已创建并进入对话：new chat')
  assert.deepEqual(await store.get('other'), { projectId: 'p1', conversationId: 'c3' })
})

test('approves or rejects a pending operation without a conversation selection', async () => {
  const { controller } = fixture()
  assert.equal((await controller.handle('chat', '/approve')).text, 'chat:approve')
  assert.equal((await controller.handle('chat', '/reject')).text, 'chat:reject')
  assert.equal((await controller.handle('chat', '/批准')).text, 'chat:approve')
  assert.equal((await controller.handle('chat', '/拒绝')).text, 'chat:reject')
})

test('keeps selections isolated by chat id and validates commands', async () => {
  const { controller } = fixture()
  await controller.handle('one', '/up + alpha')
  assert.match((await controller.handle('two', '/lc')).text, /请先使用 \/up/u)
  assert.match((await controller.handle('one', '/uc + 0')).text, /用法/u)
  assert.match((await controller.handle('one', '/uc + 9')).text, /超出范围/u)
  assert.match((await controller.handle('one', '/unknown')).text, /未知指令/u)
})
