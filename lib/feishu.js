import * as lark from '@larksuiteoapi/node-sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const OPEN_API = 'https://open.feishu.cn/open-apis';
const IMAGE_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
function sniffImageMediaType(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return 'image/gif';
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
        return 'image/webp';
    return undefined;
}
function extensionFor(mediaType) {
    return IMAGE_EXTENSIONS[mediaType] ?? 'png';
}
function sanitizeFileName(name) {
    const base = String(name ?? '').split(/[\\/]/u).pop() ?? '';
    const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/gu, '_').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 180) : 'file';
}
function parseJson(content) {
    try {
        return JSON.parse(content ?? '{}');
    }
    catch {
        return {};
    }
}
export class FeishuBot {
    options;
    client;
    ws;
    dispatcher;
    seen = new Set();
    stopped = true;
    token;
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
        if (message?.chat_id === undefined || message.message_id === undefined)
            return;
        const senderOpenId = data.sender?.sender_id?.open_id;
        if (!isSenderAllowed(message.chat_id, senderOpenId, this.options.allowedChats, this.options.allowedUsers))
            return;
        if (this.seen.has(message.message_id))
            return;
        this.seen.add(message.message_id);
        if (this.seen.size > 1000)
            this.seen.delete(this.seen.values().next().value);
        const parsed = await this.parseMessage(message.message_type, message.content, message.message_id);
        if (parsed.text.length === 0 && parsed.images.length === 0) {
            // Say why nothing was accepted instead of dropping the message silently.
            const chatId = message.chat_id;
            if (message.message_type === 'file')
                await this.sendOne(chatId, '文件接收失败，请重试，或改用文字、图片发送。').catch(this.options.onError);
            else if (message.message_type === 'audio' || message.message_type === 'media')
                await this.sendOne(chatId, '暂不支持音视频消息，请发送文字、图片或文件。').catch(this.options.onError);
            else if (message.message_type === 'sticker')
                await this.sendOne(chatId, '暂不支持表情包消息，请发文字、图片或文件。').catch(this.options.onError);
            return;
        }
        await runWithThinkingMessage({
            onMessage: () => this.options.onMessage({
                chatId: message.chat_id,
                messageId: message.message_id,
                ...(senderOpenId === undefined ? {} : { senderOpenId }),
                text: parsed.text,
                images: parsed.images,
            }),
            sendThinking: () => this.sendOne(message.chat_id, '思考中…'),
            update: (messageId, reply) => this.update(messageId, message.chat_id, reply),
            send: reply => this.send(message.chat_id, reply),
            onError: this.options.onError,
        });
    }
    async parseMessage(type, content, messageId) {
        const body = parseJson(content);
        if (type === 'text')
            return { text: typeof body.text === 'string' ? body.text.trim() : '', images: [] };
        if (type === 'post')
            return this.parsePost(body, messageId);
        if (type === 'image') {
            const key = typeof body.image_key === 'string' ? body.image_key : undefined;
            if (key === undefined)
                return { text: '', images: [] };
            try {
                return { text: '', images: [await this.downloadImage(messageId, key)] };
            }
            catch (error) {
                this.options.onError(error);
                return { text: '', images: [] };
            }
        }
        if (type === 'file') {
            const key = typeof body.file_key === 'string' ? body.file_key : undefined;
            const name = typeof body.file_name === 'string' ? body.file_name : undefined;
            if (key === undefined)
                return { text: '', images: [] };
            try {
                const file = await this.downloadFile(messageId, key, name);
                return {
                    text: `[用户发来文件] ${file.name}（${file.size} 字节）\n本地路径：${file.path}\n如需阅读或处理，请直接用工具读取该路径。`,
                    images: [],
                };
            }
            catch (error) {
                this.options.onError(error);
                return { text: '', images: [] };
            }
        }
        return { text: '', images: [] };
    }
    async parsePost(post, messageId) {
        // Feishu wraps rich-post bodies per locale (`zh_cn`, `en_us`, ...) unless the client
        // already sent the unwrapped form, so accept both shapes.
        if (post !== null && typeof post === 'object' && !Array.isArray(post.content)) {
            for (const locale of ['zh_cn', 'en_us', 'ja_jp']) {
                const wrapped = post[locale];
                if (wrapped !== null && typeof wrapped === 'object' && Array.isArray(wrapped.content)) {
                    post = wrapped;
                    break;
                }
            }
        }
        const images = [];
        const lines = [];
        const rows = Array.isArray(post.content) ? post.content : [];
        for (const row of rows) {
            let line = '';
            for (const element of Array.isArray(row) ? row : []) {
                const tag = element.tag;
                if (tag === 'text' && typeof element.text === 'string')
                    line += element.text;
                else if (tag === 'a' && typeof element.text === 'string')
                    line += typeof element.href === 'string' && element.href.length > 0 ? `${element.text} (${element.href})` : element.text;
                else if (tag === 'at' && typeof element.text === 'string')
                    line += element.text;
                else if (tag === 'md' && typeof element.text === 'string')
                    line += element.text;
                else if (tag === 'code_block' && typeof element.text === 'string')
                    line += `\n\`\`\`${typeof element.language === 'string' ? element.language : ''}\n${element.text}\n\`\`\`\n`;
                else if (tag === 'hr')
                    line += '\n---\n';
                else if (tag === 'emotion')
                    line += `[${typeof element.emoji_type === 'string' ? element.emoji_type : '表情'}]`;
                else if (tag === 'img' && typeof element.image_key === 'string')
                    images.push(element.image_key);
            }
            const trimmed = line.trim();
            if (trimmed.length > 0)
                lines.push(trimmed);
        }
        const title = typeof post.title === 'string' ? post.title.trim() : '';
        const text = [title, ...lines].filter(part => part.length > 0).join('\n');
        const attachments = [];
        for (const key of images) {
            try {
                attachments.push(await this.downloadImage(messageId, key));
            }
            catch (error) {
                this.options.onError(error);
            }
        }
        return { text, images: attachments };
    }
    async tenantToken() {
        if (this.token !== undefined && this.token.expiresAt > Date.now())
            return this.token.value;
        const response = await fetch(`${OPEN_API}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }),
        });
        const body = (await response.json());
        if (typeof body.tenant_access_token !== 'string')
            throw new Error(`获取 Feishu tenant token 失败：${body.code} ${body.msg}`);
        this.token = {
            value: body.tenant_access_token,
            expiresAt: Date.now() + Math.max(60, Number(body.expire ?? 7200) - 120) * 1000,
        };
        return this.token.value;
    }
    async downloadImage(messageId, imageKey) {
        const token = await this.tenantToken();
        const response = await fetch(`${OPEN_API}/im/v1/messages/${messageId}/resources/${imageKey}?type=image`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
            throw new Error(`下载图片失败：HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const mediaType = sniffImageMediaType(bytes);
        if (mediaType === undefined)
            throw new Error('下载的图片格式不受支持');
        return {
            data: Buffer.from(bytes).toString('base64'),
            mediaType,
            name: `feishu-${imageKey.slice(-8)}.${extensionFor(mediaType)}`,
        };
    }
    async downloadFile(messageId, fileKey, fileName) {
        const token = await this.tenantToken();
        const response = await fetch(`${OPEN_API}/im/v1/messages/${messageId}/resources/${fileKey}?type=file`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(120000),
        });
        if (!response.ok)
            throw new Error(`下载文件失败：HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 50 * 1024 * 1024)
            throw new Error('文件超过 50MB，未接收');
        const dir = join(this.fileDir(), messageId);
        await mkdir(dir, { recursive: true });
        const name = sanitizeFileName(fileName ?? `feishu-${fileKey.slice(-8)}`);
        const path = join(dir, name);
        await writeFile(path, bytes);
        return { name, size: bytes.length, path };
    }
    fileDir() {
        return this.options.fileDir ?? join(process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh'), 'feishu-bot', 'files');
    }
    async send(chatId, text) {
        for (const chunk of splitText(text, 3500))
            await this.sendOne(chatId, chunk);
    }
    async sendOne(chatId, text) {
        const response = await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text }),
            },
        });
        return response.data?.message_id;
    }
    async update(messageId, chatId, text) {
        const [first, ...rest] = splitText(text, 3500);
        await this.client.im.message.update({
            path: { message_id: messageId },
            data: { msg_type: 'text', content: JSON.stringify({ text: first ?? '' }) },
        });
        for (const chunk of rest)
            await this.sendOne(chatId, chunk);
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