import * as lark from '@larksuiteoapi/node-sdk';
import { cardContent, splitCardMarkdown, toFeishuMarkdown } from './format.js';
export class FeishuBot {
    options;
    client;
    ws;
    dispatcher;
    seen = new Set();
    stopped = true;
    constructor(options) {
        this.options = options;
        this.client = new lark.Client({ appId: options.appId, appSecret: options.appSecret });
        this.ws = new lark.WSClient({
            appId: options.appId,
            appSecret: options.appSecret,
            autoReconnect: true,
            ...(options.pingTimeoutSeconds === undefined ? {} : { wsConfig: { pingTimeout: options.pingTimeoutSeconds } }),
            ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
            onError: options.onError,
            ...(options.onReconnecting === undefined ? {} : { onReconnecting: options.onReconnecting }),
            ...(options.onReady === undefined ? {} : { onReconnected: options.onReady }),
        });
        this.dispatcher = new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data) => this.receive(data),
        });
    }
    start() {
        if (!this.stopped)
            return;
        this.stopped = false;
        void this.ws.start({ eventDispatcher: this.dispatcher }).catch(error => this.options.onError(error));
    }
    async stop() {
        this.stopped = true;
        const stoppable = this.ws;
        await stoppable.close?.();
    }
    async sendText(chatId, text) {
        await this.send(chatId, text);
    }
    async receive(data) {
        const message = data.message;
        if (message?.message_type !== 'text' || message.chat_id === undefined || message.message_id === undefined)
            return;
        const senderOpenId = data.sender?.sender_id?.open_id;
        if (!isSenderAllowed(message.chat_id, senderOpenId, this.options.allowedChats, this.options.allowedUsers))
            return;
        if (this.seen.has(message.message_id))
            return;
        this.seen.add(message.message_id);
        if (this.seen.size > 1000)
            this.seen.delete(this.seen.values().next().value);
        let text;
        try {
            const content = JSON.parse(message.content ?? '{}');
            text = typeof content.text === 'string' ? content.text.trim() : '';
        }
        catch {
            text = '';
        }
        if (text.length === 0)
            return;
        await runWithThinkingMessage({
            onMessage: () => this.options.onMessage({
                chatId: message.chat_id,
                messageId: message.message_id,
                ...(senderOpenId === undefined ? {} : { senderOpenId }),
                text,
            }),
            sendThinking: () => this.sendOne(message.chat_id, '思考中…'),
            update: (messageId, reply) => this.update(messageId, message.chat_id, reply),
            send: reply => this.send(message.chat_id, reply),
            onError: this.options.onError,
        });
    }
    async send(chatId, text) {
        for (const chunk of splitCardMarkdown(toFeishuMarkdown(text)))
            await this.sendCard(chatId, chunk, chunk);
    }
    async sendOne(chatId, text) {
        return this.sendCard(chatId, toFeishuMarkdown(text), text);
    }
    /** Post rich Markdown as an interactive card; fall back to plain text when the card is rejected. */
    async sendCard(chatId, markdown, plain) {
        try {
            const response = await this.client.im.message.create({
                params: { receive_id_type: 'chat_id' },
                data: { receive_id: chatId, msg_type: 'interactive', content: cardContent(markdown) },
            });
            return response.data?.message_id;
        }
        catch (error) {
            if (plain === undefined)
                throw error;
            this.options.onError(error);
            const response = await this.client.im.message.create({
                params: { receive_id_type: 'chat_id' },
                data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: plain }) },
            });
            return response.data?.message_id;
        }
    }
    async update(messageId, chatId, text) {
        const chunks = splitCardMarkdown(toFeishuMarkdown(text));
        try {
            await this.client.im.message.patch({ path: { message_id: messageId }, data: { content: cardContent(chunks[0] ?? '') } });
        }
        catch (error) {
            // A placeholder that cannot be patched (for example one sent as plain text) is replaced, never left behind.
            this.options.onError(error);
            await this.client.im.message.delete({ path: { message_id: messageId } }).catch(() => { });
            for (const chunk of chunks)
                await this.sendCard(chatId, chunk, chunk);
            return;
        }
        for (const chunk of chunks.slice(1))
            await this.sendCard(chatId, chunk, chunk);
    }
}
export async function runWithThinkingMessage(options) {
    let thinkingId;
    try {
        thinkingId = await options.sendThinking();
    }
    catch (error) {
        options.onError(error);
    }
    try {
        const reply = await options.onMessage();
        if (thinkingId !== undefined) {
            try {
                await options.update(thinkingId, reply);
                return;
            }
            catch (error) {
                options.onError(error);
            }
        }
        await options.send(reply);
    }
    catch (error) {
        options.onError(error);
        const detail = error instanceof Error ? error.message : String(error);
        const failure = `操作失败：${detail}`;
        if (thinkingId !== undefined) {
            try {
                await options.update(thinkingId, failure);
                return;
            }
            catch (updateError) {
                options.onError(updateError);
            }
        }
        await options.send(failure).catch(options.onError);
    }
}
export function isSenderAllowed(chatId, senderOpenId, allowedChats, allowedUsers) {
    return senderOpenId !== undefined && allowedUsers.has(senderOpenId)
        && (allowedChats.size === 0 || allowedChats.has(chatId));
}
export function splitText(text, maxLength) {
    const characters = Array.from(text);
    if (characters.length <= maxLength)
        return [text];
    const chunks = [];
    let offset = 0;
    while (characters.length - offset > maxLength) {
        const window = characters.slice(offset, offset + maxLength);
        const newline = window.lastIndexOf('\n');
        const length = newline > maxLength / 2 ? newline : maxLength;
        chunks.push(characters.slice(offset, offset + length).join(''));
        offset += length;
        if (characters[offset] === '\n')
            offset++;
    }
    if (offset < characters.length)
        chunks.push(characters.slice(offset).join(''));
    return chunks;
}
//# sourceMappingURL=feishu.js.map