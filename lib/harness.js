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
function titleFor(id, events) {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event?.type !== 'session/title')
            continue;
        const data = event.data;
        if (typeof data.title === 'string' && data.title.length > 0)
            return data.title;
    }
    return `对话 ${id.slice(-8)}`;
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
function lastAssistantText(events, fromSeq) {
    const messages = events
        .slice(fromSeq)
        .filter(event => event.type === 'assistant/message')
        .map(event => messageText(event))
        .filter((text) => text !== undefined);
    return messages.at(-1)?.replace(/^Harness：/u, '') ?? 'Harness 已处理消息，但没有返回文本内容。';
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
            const session = this.ctx.agents.get(id)?.session;
            const events = session?.events ?? (await this.ctx.sessionPersistence.inspect(id)).events;
            rows.push({ id, name: titleFor(id, events) });
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
        const live = this.ctx.agents.get(id)?.session;
        const events = live?.events ?? (await this.ctx.sessionPersistence.inspect(id)).events;
        return { id: conversationId, name: titleFor(conversationId, events) };
    }
    async recentMessages(conversationId, count) {
        const id = asSessionId(conversationId);
        const live = this.ctx.agents.get(id)?.session;
        const events = live?.events ?? (await this.ctx.sessionPersistence.inspect(id)).events;
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
            const fromSeq = agent.session?.seq ?? 0;
            agent.followup(userMessage(text));
            await agent.whenIdle();
            await this.ctx.sessions.flush(agent.session);
            // On dsh >= 0.1.2-alpha the live session may no longer expose `events`
            // after the agent goes idle; fall back to the persisted session log so a
            // completed turn still produces a reply instead of crashing on
            // `events.slice(fromSeq)` with an undefined value.
            const events = agent.session?.events
                ?? (await this.ctx.sessionPersistence.inspect(id)).events
                ?? [];
            const reply = lastAssistantText(events, fromSeq);
            try {
                await this.onCompleted?.({ conversationId, chatId, reply });
            }
            catch {
                // Completion notifications are best-effort and must not hide a completed answer.
            }
            return reply;
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