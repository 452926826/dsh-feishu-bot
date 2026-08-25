export type ApprovalDecision = 'approve' | 'reject'
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

export interface ApprovalPrompt {
  sessionId: string
  toolName: string
  reason?: string
  arguments?: string
  signal?: AbortSignal
}

interface PendingApproval {
  resolve(outcome: ApprovalOutcome): void
  signal?: AbortSignal
  onAbort?(): void
}

export class ApprovalCoordinator {
  private readonly routes = new Map<string, string>()
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly send: (chatId: string, text: string) => Promise<unknown>) {}

  bind(sessionId: string, chatId: string): { dispose(): void } {
    const existing = this.routes.get(sessionId)
    if (existing !== undefined && existing !== chatId) return { dispose: () => undefined }
    this.routes.set(sessionId, chatId)
    return {
      dispose: () => {
        if (this.routes.get(sessionId) !== chatId) return
        this.routes.delete(sessionId)
        this.settle(chatId, 'cancelled')
      },
    }
  }

  async request(prompt: ApprovalPrompt): Promise<ApprovalOutcome | undefined> {
    const chatId = this.routes.get(prompt.sessionId)
    if (chatId === undefined || this.pending.has(chatId)) return undefined
    if (prompt.signal?.aborted === true) return 'cancelled'

    let resolve!: (outcome: ApprovalOutcome) => void
    const answer = new Promise<ApprovalOutcome>(settle => { resolve = settle })
    const pending: PendingApproval = { resolve, ...(prompt.signal === undefined ? {} : { signal: prompt.signal }) }
    const onAbort = () => this.settle(chatId, 'cancelled')
    pending.onAbort = onAbort
    this.pending.set(chatId, pending)
    prompt.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      await this.send(chatId, formatApprovalPrompt(prompt))
    } catch {
      this.pending.delete(chatId)
      prompt.signal?.removeEventListener('abort', onAbort)
      return undefined
    }
    return answer
  }

  respond(chatId: string, decision: ApprovalDecision): string {
    const pending = this.pending.get(chatId)
    if (pending === undefined) return '当前没有待审批操作。'
    this.settle(chatId, decision === 'approve' ? 'allowed-once' : 'rejected')
    return decision === 'approve' ? '已批准本次操作。' : '已拒绝本次操作。'
  }

  private settle(chatId: string, outcome: ApprovalOutcome): void {
    const pending = this.pending.get(chatId)
    if (pending === undefined) return
    this.pending.delete(chatId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    pending.resolve(outcome)
  }
}

interface HarnessApprovalRequest {
  agent: {
    session: {
      id: string
      events: ReadonlyArray<{ type: string; data?: unknown }>
    }
  }
  toolName: string
  callId?: unknown
  reason?: string
  signal?: AbortSignal
}

export async function handleApprovalRequest(
  approvals: ApprovalCoordinator,
  request: HarnessApprovalRequest,
  next: () => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>,
): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> {
  const call = request.callId === undefined ? undefined : request.agent.session.events.find(event => {
    if (event.type !== 'tool/call') return false
    return ((event.data ?? {}) as { callId?: unknown }).callId === request.callId
  })
  const args = (call?.data ?? {}) as { arguments?: unknown }
  const outcome = await approvals.request({
    sessionId: request.agent.session.id,
    toolName: request.toolName,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(typeof args?.arguments === 'string' ? { arguments: args.arguments } : {}),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  return outcome ?? next()
}

export function formatApprovalPrompt(prompt: ApprovalPrompt): string {
  const lines = [
    'Harness 请求审批',
    `工具：${prompt.toolName}`,
  ]
  if (prompt.reason !== undefined && prompt.reason.trim().length > 0) lines.push(`原因：${prompt.reason.trim()}`)
  if (prompt.arguments !== undefined && prompt.arguments.trim().length > 0) {
    const value = Array.from(prompt.arguments.trim()).slice(0, 2000).join('')
    lines.push(`参数：\n${value}${Array.from(prompt.arguments.trim()).length > 2000 ? '\n…' : ''}`)
  }
  lines.push('', '回复 /approve 批准本次操作，或 /reject 拒绝。')
  return lines.join('\n')
}
