export interface ProjectInfo {
  id: string
  name: string
  path: string
}

export interface ConversationInfo {
  id: string
  name: string
}

export interface ChatSelection {
  projectId?: string
  conversationId?: string
}

export interface HarnessBridge {
  listProjects(): Promise<ProjectInfo[]>
  createProject(name: string): Promise<ProjectInfo>
  listConversations(projectId: string): Promise<ConversationInfo[]>
  createConversation(projectId: string): Promise<ConversationInfo>
  recentMessages(conversationId: string, count: number): Promise<string[]>
  converse(conversationId: string, text: string, chatId: string): Promise<string>
  respondToApproval(chatId: string, decision: 'approve' | 'reject'): string
}

export interface SelectionStore {
  get(chatId: string): Promise<ChatSelection>
  set(chatId: string, selection: ChatSelection): Promise<void>
}

export type ControllerResult = {
  text: string
  selection?: ChatSelection
}

const HELP = [
  '可用指令：',
  '/lp - 列出所有项目',
  '/up + 项目名或索引 - 进入项目',
  '/np + 项目名 - 创建项目',
  '/lc - 列出当前项目的对话',
  '/uc + 索引 - 进入对话并显示最近 2 条记录',
  '/nc - 在当前项目创建对话',
  '/approve - 批准当前待审批操作（仅本次）',
  '/reject - 拒绝当前待审批操作',
  '/help - 显示帮助',
].join('\n')

function argumentAfter(text: string, command: string): string {
  const raw = text.slice(command.length).trim()
  return raw.startsWith('+') ? raw.slice(1).trim() : raw
}

function formatProjects(projects: ProjectInfo[], selectedId?: string): string {
  if (projects.length === 0) return '还没有项目。使用 /np + 项目名 创建。'
  return projects.map((project, index) => {
    const selected = project.id === selectedId ? '（当前）' : ''
    return `${index + 1}，${project.name}${selected}`
  }).join('\n')
}

function formatConversations(conversations: ConversationInfo[], selectedId?: string): string {
  if (conversations.length === 0) return '当前项目还没有对话。使用 /nc 创建。'
  return conversations.map((conversation, index) => {
    const selected = conversation.id === selectedId ? '（当前）' : ''
    return `${index + 1}，${conversation.name}${selected}`
  }).join('\n')
}

function exactProject(projects: ProjectInfo[], name: string): ProjectInfo | undefined {
  const normalized = name.trim().toLocaleLowerCase()
  return projects.find(project => project.name.toLocaleLowerCase() === normalized)
}

function projectByArgument(projects: ProjectInfo[], argument: string): ProjectInfo | undefined {
  if (!/^\d+$/u.test(argument)) return exactProject(projects, argument)
  const index = Number(argument)
  if (!Number.isSafeInteger(index) || index < 1) return undefined
  return projects[index - 1]
}

export class FeishuCommandController {
  constructor(
    private readonly bridge: HarnessBridge,
    private readonly selections: SelectionStore,
  ) {}

  async handle(chatId: string, input: string): Promise<ControllerResult> {
    const text = input.trim()
    if (text.length === 0) return { text: HELP }
    if (text === '/approve' || text === '/批准') {
      return { text: this.bridge.respondToApproval(chatId, 'approve') }
    }
    if (text === '/reject' || text === '/拒绝') {
      return { text: this.bridge.respondToApproval(chatId, 'reject') }
    }
    const selection = await this.selections.get(chatId)

    if (text === '/help') return { text: HELP }

    if (text === '/lp') {
      const projects = await this.bridge.listProjects()
      return { text: formatProjects(projects, selection.projectId) }
    }

    if (text.startsWith('/up')) {
      const argument = argumentAfter(text, '/up')
      if (argument.length === 0) return { text: '用法：/up + 项目名或索引，例如 /up + 1' }
      const projects = await this.bridge.listProjects()
      if (/^[+-]?\d+(?:\.\d+)?$/u.test(argument)) {
        const index = Number(argument)
        if (!Number.isSafeInteger(index) || index < 1) return { text: '用法：/up + 项目名或索引，例如 /up + 1' }
        const project = projects[index - 1]
        if (project === undefined) return { text: `项目索引超出范围：${argument}` }
        const next = { projectId: project.id }
        await this.selections.set(chatId, next)
        return { text: `已进入项目：${project.name}`, selection: next }
      }
      const project = projectByArgument(projects, argument)
      if (project === undefined) return { text: `未找到项目：${argument}` }
      const next = { projectId: project.id }
      await this.selections.set(chatId, next)
      return { text: `已进入项目：${project.name}`, selection: next }
    }

    if (text.startsWith('/np')) {
      const name = argumentAfter(text, '/np')
      if (name.length === 0) return { text: '用法：/np + 项目名' }
      const project = await this.bridge.createProject(name)
      const next = { projectId: project.id }
      await this.selections.set(chatId, next)
      return { text: `已创建并进入项目：${project.name}`, selection: next }
    }

    if (text === '/lc') {
      if (selection.projectId === undefined) return { text: '请先使用 /up + 项目名或索引 进入项目。' }
      const conversations = await this.bridge.listConversations(selection.projectId)
      return { text: formatConversations(conversations, selection.conversationId) }
    }

    if (text.startsWith('/uc')) {
      if (selection.projectId === undefined) return { text: '请先使用 /up + 项目名或索引 进入项目。' }
      const rawIndex = argumentAfter(text, '/uc')
      const index = Number(rawIndex)
      if (!Number.isSafeInteger(index) || index < 1) return { text: '用法：/uc + 索引，例如 /uc + 1' }
      const conversations = await this.bridge.listConversations(selection.projectId)
      const conversation = conversations[index - 1]
      if (conversation === undefined) return { text: `对话索引超出范围：${rawIndex}` }
      const next = { ...selection, conversationId: conversation.id }
      await this.selections.set(chatId, next)
      const history = await this.bridge.recentMessages(conversation.id, 2)
      const suffix = history.length === 0 ? '\n暂无历史记录。' : `\n最近 2 条记录：\n${history.join('\n')}`
      return { text: `已进入对话：${conversation.name}${suffix}`, selection: next }
    }

    if (text === '/nc') {
      if (selection.projectId === undefined) return { text: '请先使用 /up + 项目名或索引 进入项目。' }
      const conversation = await this.bridge.createConversation(selection.projectId)
      const next = { ...selection, conversationId: conversation.id }
      await this.selections.set(chatId, next)
      return { text: `已创建并进入对话：${conversation.name}`, selection: next }
    }

    if (text.startsWith('/')) return { text: `未知指令：${text.split(/\s/u, 1)[0]}\n\n${HELP}` }
    if (selection.conversationId === undefined) return { text: '请先使用 /uc + 索引进入对话，或使用 /nc 创建对话。' }
    return { text: await this.bridge.converse(selection.conversationId, text, chatId) }
  }
}
