import * as lark from '@larksuiteoapi/node-sdk'

export interface FeishuInboundMessage {
  chatId: string
  messageId: string
  senderOpenId?: string
  text: string
}

interface FeishuEvent {
  sender?: {
    sender_id?: { open_id?: string }
  }
  message?: {
    chat_id?: string
    message_id?: string
    message_type?: string
    content?: string
  }
}

export interface FeishuBotOptions {
  appId: string
  appSecret: string
  allowedChats: ReadonlySet<string>
  allowedUsers: ReadonlySet<string>
  onMessage(message: FeishuInboundMessage): Promise<string>
  onReady?(): void
  onError(error: unknown): void
  onReconnecting?(): void
  pingTimeoutSeconds?: number
}

export class FeishuBot {
  private readonly client: lark.Client
  private readonly ws: lark.WSClient
  private readonly dispatcher: lark.EventDispatcher
  private readonly seen = new Set<string>()
  private stopped = true

  constructor(private readonly options: FeishuBotOptions) {
    this.client = new lark.Client({ appId: options.appId, appSecret: options.appSecret })
    this.ws = new lark.WSClient({
      appId: options.appId,
      appSecret: options.appSecret,
      autoReconnect: true,
      ...(options.pingTimeoutSeconds === undefined ? {} : { wsConfig: { pingTimeout: options.pingTimeoutSeconds } }),
      ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
      onError: options.onError,
      ...(options.onReconnecting === undefined ? {} : { onReconnecting: options.onReconnecting }),
      ...(options.onReady === undefined ? {} : { onReconnected: options.onReady }),
    })
    this.dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuEvent) => this.receive(data),
    })
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.ws.start({ eventDispatcher: this.dispatcher }).catch(error => this.options.onError(error))
  }

  async stop(): Promise<void> {
    this.stopped = true
    const stoppable = this.ws as unknown as { close?: () => Promise<void> | void }
    await stoppable.close?.()
  }


  async sendText(chatId: string, text: string): Promise<void> {
    await this.send(chatId, text)
  }

  private async receive(data: FeishuEvent): Promise<void> {
    const message = data.message
    if (message?.message_type !== 'text' || message.chat_id === undefined || message.message_id === undefined) return
    const senderOpenId = data.sender?.sender_id?.open_id
    if (!isSenderAllowed(message.chat_id, senderOpenId, this.options.allowedChats, this.options.allowedUsers)) return
    if (this.seen.has(message.message_id)) return
    this.seen.add(message.message_id)
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string)

    let text: string
    try {
      const content = JSON.parse(message.content ?? '{}') as { text?: unknown }
      text = typeof content.text === 'string' ? content.text.trim() : ''
    } catch {
      text = ''
    }
    if (text.length === 0) return

    await this.runWithReactionIndicator(
      message.chat_id as string,
      message.message_id as string,
      () => this.options.onMessage({
        chatId: message.chat_id as string,
        messageId: message.message_id as string,
        ...(senderOpenId === undefined ? {} : { senderOpenId }),
        text,
      }),
    )
  }

  /**
   * Runs `run` while showing a reaction-based status indicator on the
   * triggering message: 🤔 (THINKING) while processing, swapped to ✅ (DONE)
   * once the turn has completed. Reaction calls are best-effort: a missing
   * scope or an unsupported emoji only logs and never breaks processing.
   * Requires the app-identity scope `im:message.reactions:write_only` on the
   * Feishu application (tenant_access_token calls).
   */
  private async runWithReactionIndicator(chatId: string, messageId: string, run: () => Promise<string>): Promise<void> {
    let reactionId: string | undefined
    let failed = false
    try {
      const created = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: 'THINKING' } },
      })
      reactionId = created.data?.reaction_id
    } catch (error) {
      this.options.onError(error)
    }
    try {
      await run()
    } catch (error) {
      failed = true
      this.options.onError(error)
      const detail = error instanceof Error ? error.message : String(error)
      await this.send(chatId, `操作失败：${detail}`).catch(this.options.onError)
    } finally {
      if (reactionId !== undefined) {
        try {
          await this.client.im.messageReaction.delete({
            path: { message_id: messageId, reaction_id: reactionId },
          })
        } catch (error) {
          this.options.onError(error)
        }
      }
      if (!failed) {
        try {
          await this.client.im.messageReaction.create({
            path: { message_id: messageId },
            data: { reaction_type: { emoji_type: 'DONE' } },
          })
        } catch (error) {
          this.options.onError(error)
        }
      }
    }
  }

  private async send(chatId: string, text: string): Promise<void> {
    for (const chunk of splitText(text, 3500)) await this.sendOne(chatId, chunk)
  }

  private async sendOne(chatId: string, text: string): Promise<string | undefined> {
    const response = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    })
    return response.data?.message_id
  }

  private async update(messageId: string, chatId: string, text: string): Promise<void> {
    const [first, ...rest] = splitText(text, 3500)
    await this.client.im.message.update({
      path: { message_id: messageId },
      data: { msg_type: 'text', content: JSON.stringify({ text: first ?? '' }) },
    })
    for (const chunk of rest) await this.sendOne(chatId, chunk)
  }
}

export async function runWithThinkingMessage(options: {
  onMessage(): Promise<string>
  sendThinking(): Promise<string | undefined>
  update(messageId: string, text: string): Promise<void>
  send(text: string): Promise<void>
  onError(error: unknown): void
}): Promise<void> {
  let thinkingId: string | undefined
  try {
    thinkingId = await options.sendThinking()
  } catch (error) {
    options.onError(error)
  }

  try {
    const reply = await options.onMessage()
    if (thinkingId !== undefined) {
      try {
        await options.update(thinkingId, reply)
        return
      } catch (error) {
        options.onError(error)
      }
    }
    await options.send(reply)
  } catch (error) {
    options.onError(error)
    const detail = error instanceof Error ? error.message : String(error)
    const failure = `操作失败：${detail}`
    if (thinkingId !== undefined) {
      try {
        await options.update(thinkingId, failure)
        return
      } catch (updateError) {
        options.onError(updateError)
      }
    }
    await options.send(failure).catch(options.onError)
  }
}

export function isSenderAllowed(
  chatId: string,
  senderOpenId: string | undefined,
  allowedChats: ReadonlySet<string>,
  allowedUsers: ReadonlySet<string>,
): boolean {
  if (allowedChats.size === 0 && allowedUsers.size === 0) return true
  if (allowedChats.has(chatId)) return true
  return senderOpenId !== undefined && allowedUsers.has(senderOpenId)
}

export function splitText(text: string, maxLength: number): string[] {
  const characters = Array.from(text)
  if (characters.length <= maxLength) return [text]
  const chunks: string[] = []
  let offset = 0
  while (characters.length - offset > maxLength) {
    const window = characters.slice(offset, offset + maxLength)
    const newline = window.lastIndexOf('\n')
    const length = newline > maxLength / 2 ? newline : maxLength
    chunks.push(characters.slice(offset, offset + length).join(''))
    offset += length
    if (characters[offset] === '\n') offset++
  }
  if (offset < characters.length) chunks.push(characters.slice(offset).join(''))
  return chunks
}
