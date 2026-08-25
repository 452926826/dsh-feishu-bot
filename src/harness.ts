import { mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { ConversationInfo, HarnessBridge, ProjectInfo } from './controller.js'

interface ApprovalRouter {
  bind(sessionId: string, chatId: string): { dispose(): void }
  respond(chatId: string, decision: 'approve' | 'reject'): string
}

interface HarnessContext extends Context {
  agents: AgentRegistry
  sessions: SessionStore
  workspaceRegistry: WorkspaceRegistry
  sessionPersistence: SessionPersistence
}

function messageText(event: SessionEvent): string | undefined {
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user') return undefined
    const text = event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    return text.length === 0 ? undefined : `你：${text}`
  }
  if (event.type === 'assistant/message') {
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    return text.length === 0 ? undefined : `Harness：${text}`
  }
  return undefined
}

function titleFor(id: string, events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as { type?: string; data?: unknown } | undefined
    if (event?.type !== 'session/title') continue
    const data = event.data as { title?: unknown }
    if (typeof data.title === 'string' && data.title.length > 0) return data.title
  }
  return `对话 ${id.slice(-8)}`
}

function asSessionId(value: string): SessionId {
  return value as SessionId
}

export function userMessage(text: string): UserMessage {
  const message: UserMessage = {
    id: randomUUID() as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

function lastAssistantText(events: readonly SessionEvent[], fromSeq: number): string {
  const messages = events
    .slice(fromSeq)
    .filter(event => event.type === 'assistant/message')
    .map(event => messageText(event))
    .filter((text): text is string => text !== undefined)
  return messages.at(-1)?.replace(/^Harness：/u, '') ?? 'Harness 已处理消息，但没有返回文本内容。'
}

export class DshHarnessBridge implements HarnessBridge {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly ctx: HarnessContext,
    private readonly projectsRoot: string,
    private readonly approvals: ApprovalRouter,
  ) {}

  async listProjects(): Promise<ProjectInfo[]> {
    return this.ctx.workspaceRegistry.list().map(workspace => ({
      id: workspace.id,
      name: workspace.title,
      path: workspace.path,
    }))
  }

  async createProject(name: string): Promise<ProjectInfo> {
    const safe = this.safeProjectName(name)
    const path = join(this.projectsRoot, safe)
    await mkdir(path, { recursive: false })
    const workspace = await this.ctx.workspaceRegistry.create(path, safe)
    return { id: workspace.id, name: workspace.title, path: workspace.path }
  }

  async listConversations(projectId: string): Promise<ConversationInfo[]> {
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === projectId)
    if (workspace === undefined) throw new Error('当前项目不存在，请重新使用 /up 选择项目。')
    const rows: ConversationInfo[] = []
    for (const id of workspace.sessionIds) {
      const session = this.ctx.agents.get(id)?.session
      const events = session?.events ?? (await this.ctx.sessionPersistence.inspect(id)).events
      rows.push({ id, name: titleFor(id, events) })
    }
    return rows
  }

  async createConversation(projectId: string): Promise<ConversationInfo> {
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === projectId)
    if (workspace === undefined) throw new Error('当前项目不存在，请重新使用 /up 选择项目。')
    const sessionId = asSessionId(`session-${randomUUID()}`)
    const handle = await this.ctx.agents.create({ sessionId, meta: { cwd: workspace.path } })
    this.handles.set(sessionId, handle)
    await workspace.attachSession(sessionId)
    return { id: sessionId, name: `新对话 ${sessionId.slice(-8)}` }
  }

  async recentMessages(conversationId: string, count: number): Promise<string[]> {
    const id = asSessionId(conversationId)
    const live = this.ctx.agents.get(id)?.session
    const events = live?.events ?? (await this.ctx.sessionPersistence.inspect(id)).events
    return events.map(messageText).filter((text): text is string => text !== undefined).slice(-count)
  }

  async converse(conversationId: string, text: string, chatId: string): Promise<string> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(() => this.runConversation(conversationId, text, chatId))
    this.queues.set(conversationId, task)
    try {
      return await task
    } finally {
      if (this.queues.get(conversationId) === task) this.queues.delete(conversationId)
    }
  }

  respondToApproval(chatId: string, decision: 'approve' | 'reject'): string {
    return this.approvals.respond(chatId, decision)
  }

  private async runConversation(conversationId: string, text: string, chatId: string): Promise<string> {
    const route = this.approvals.bind(conversationId, chatId)
    try {
      const id = asSessionId(conversationId)
      const agent = await this.ensureAgent(id)
      const fromSeq = agent.session.seq
      agent.followup(userMessage(text))
      await agent.whenIdle()
      await this.ctx.sessions.flush(agent.session)
      return lastAssistantText(agent.session.events, fromSeq)
    } finally {
      route.dispose()
    }
  }

  private async ensureAgent(id: SessionId): Promise<Agent> {
    const live = this.ctx.agents.get(id)
    if (live !== undefined) return live
    const handle = await this.ctx.agents.resume({ resumeSessionId: id })
    this.handles.set(id, handle)
    return handle.agent
  }

  private safeProjectName(input: string): string {
    const name = basename(input.trim())
    if (name.length === 0 || name === '.' || name === '..' || name !== input.trim()) {
      throw new Error('项目名只能是单个目录名，不能包含路径。')
    }
    return name
  }
}

export function resolveProjectsRoot(value: string): string {
  return resolve(value)
}
