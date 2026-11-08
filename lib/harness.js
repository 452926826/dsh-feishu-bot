import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
function messageText(event) {
    if (event.type === 'user/message') {
        if (event.data.source.kind !== 'user')
            return undefined;
        const text = event.data.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim();
        return text.length === 0 ? undefined : `你：${text}`;
    }
    if (event.type === 'assistant/message') {
        const text = event.data.message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim();
        return text.length === 0 ? undefined : `Harness：${text}`;
    }
    return undefined;
}
function asSessionId(value) {
    return value;
}
export function userMessage(text) {
    const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
    };
    Object.freeze(message.content[0]);
    Object.freeze(message.content);
    Object.freeze(message.source);
    return Object.freeze(message);
}
const EMPTY_REPLY = 'Harness 已处理消息，但没有返回文本内容。';
function lastAssistantText(events, fromSeq) {
    const messages = events
        .slice(fromSeq)
        .filter(event => event.type === 'assistant/message')
        .map(event => messageText(event))
        .filter((text) => text !== undefined);
    return messages.at(-1)?.replace(/^Harness：/u, '') ?? EMPTY_REPLY;
}
/**
 * Describe why the last turn stopped when it did not complete normally.
 * A failed turn produces no assistant message, so without this the bot would
 * report EMPTY_REPLY and hide the provider error.
 */
function turnStopNote(events, fromSeq) {
    for (let index = events.length - 1; index >= fromSeq; index--) {
        const event = events[index];
        if (event === undefined || event.type !== 'turn/end')
            continue;
        const reason = event.data?.reason;
        if (reason === undefined || reason.kind === 'completed')
            return undefined;
        if (reason.kind === 'error') {
            const error = (reason.error ?? {});
            const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : '未知错误';
            const code = typeof error.code === 'string' && error.code.length > 0
                ? `（${error.code}${typeof error.status === 'number' ? ` ${error.status}` : ''}）`
                : '';
            return `${message}${code}`;
        }
        if (reason.kind === 'aborted')
            return '本轮被取消。';
        if (reason.kind === 'blocked')
            return '本轮被策略拦截。';
        if (reason.kind === 'max-tokens')
            return '本轮达到输出上限。';
        if (reason.kind === 'interrupted')
            return '本轮因进程中断而终止。';
        return `本轮以 ${reason.kind} 结束。`;
    }
    return undefined;
}
export class DshHarnessBridge {
    ctx;
    projectsRoot;
    approvals;
    onCompleted;
    handles = new Map();
    queues = new Map();
    constructor(ctx, projectsRoot, approvals, onCompleted) {
        this.ctx = ctx;
        this.projectsRoot = projectsRoot;
        this.approvals = approvals;
        this.onCompleted = onCompleted;
    }
    async listProjects() {
        return this.ctx.workspaceRegistry.list().map(workspace => ({
            id: workspace.id,
            name: workspace.title,
            path: workspace.path,
        }));
    }
    async createProject(name) {
        const safe = this.safeProjectName(name);
        const path = join(this.projectsRoot, safe);
        await mkdir(path, { recursive: false });
        const workspace = await this.ctx.workspaceRegistry.create(path, safe);
        return { id: workspace.id, name: workspace.title, path: workspace.path };
    }
    async listConversations(projectId) {
        const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === projectId);
        if (workspace === undefined)
            throw new Error('当前项目不存在，请重新使用 /up 选择项目。');
        const rows = [];
        for (const id of workspace.sessionIds) {
            const title = await this.ctx.sessionQuery.readTitle(id);
            rows.push({ id, name: title?.title ?? `对话 ${id.slice(-8)}` });
        }
        return rows;
    }
    async createConversation(projectId) {
        const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === projectId);
        if (workspace === undefined)
            throw new Error('当前项目不存在，请重新使用 /up 选择项目。');
        const sessionId = asSessionId(`session-${randomUUID()}`);
        const handle = await this.ctx.agents.create({ sessionId, meta: { cwd: workspace.path } });
        this.handles.set(sessionId, handle);
        await workspace.attachSession(sessionId);
        return { id: sessionId, name: `新对话 ${sessionId.slice(-8)}` };
    }
    async conversationInfo(conversationId) {
        const workspace = this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(asSessionId(conversationId)));
        if (workspace === undefined)
            return undefined;
        const id = asSessionId(conversationId);
        const title = await this.ctx.sessionQuery.readTitle(id);
        return { id: conversationId, name: title?.title ?? `对话 ${id.slice(-8)}` };
    }
    async recentMessages(conversationId, count) {
        const id = asSessionId(conversationId);
        const { events } = await this.ctx.sessionQuery.readSession(id);
        return events.map(messageText).filter((text) => text !== undefined).slice(-count);
    }
    async converse(conversationId, text, chatId) {
        const previous = this.queues.get(conversationId) ?? Promise.resolve();
        const task = previous.catch(() => undefined).then(() => this.runConversation(conversationId, text, chatId));
        this.queues.set(conversationId, task);
        try {
            return await task;
        }
        finally {
            if (this.queues.get(conversationId) === task)
                this.queues.delete(conversationId);
        }
    }
    respondToApproval(chatId, decision) {
        return this.approvals.respond(chatId, decision);
    }
    async runConversation(conversationId, text, chatId) {
        const route = this.approvals.bind(conversationId, chatId);
        try {
            const id = asSessionId(conversationId);
            const agent = await this.ensureAgent(id);
            const fromSeq = agent.session.seq;
            agent.followup(userMessage(text));
            await agent.whenIdle();
            await this.ctx.sessions.flush(agent.session);
            const events = (await this.ctx.sessionQuery.readSession(id)).events;
            const reply = lastAssistantText(events, fromSeq);
            const stop = turnStopNote(events, fromSeq);
            const answer = stop === undefined
                ? reply
                : reply === EMPTY_REPLY
                    ? `⚠️ 本轮执行失败：${stop}`
                    : `${reply}\n\n⚠️ 本轮执行中断：${stop}`;
            try {
                await this.onCompleted?.({ conversationId, chatId, reply: answer });
            }
            catch {
                // Completion notifications are best-effort and must not hide a completed answer.
            }
            return answer;
        }
        finally {
            route.dispose();
        }
    }
    async ensureAgent(id) {
        const live = this.ctx.agents.get(id);
        if (live !== undefined)
            return live;
        const handle = await this.ctx.agents.resume({ resumeSessionId: id });
        this.handles.set(id, handle);
        return handle.agent;
    }
    safeProjectName(input) {
        const name = basename(input.trim());
        if (name.length === 0 || name === '.' || name === '..' || name !== input.trim()) {
            throw new Error('项目名只能是单个目录名，不能包含路径。');
        }
        return name;
    }
}
export function resolveProjectsRoot(value) {
    return resolve(value);
}
//# sourceMappingURL=harness.js.map