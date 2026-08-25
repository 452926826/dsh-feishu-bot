export class ApprovalCoordinator {
    send;
    routes = new Map();
    pending = new Map();
    constructor(send) {
        this.send = send;
    }
    bind(sessionId, chatId) {
        const existing = this.routes.get(sessionId);
        if (existing !== undefined && existing !== chatId)
            return { dispose: () => undefined };
        this.routes.set(sessionId, chatId);
        return {
            dispose: () => {
                if (this.routes.get(sessionId) !== chatId)
                    return;
                this.routes.delete(sessionId);
                this.settle(chatId, 'cancelled');
            },
        };
    }
    async request(prompt) {
        const chatId = this.routes.get(prompt.sessionId);
        if (chatId === undefined || this.pending.has(chatId))
            return undefined;
        if (prompt.signal?.aborted === true)
            return 'cancelled';
        let resolve;
        const answer = new Promise(settle => { resolve = settle; });
        const pending = { resolve, ...(prompt.signal === undefined ? {} : { signal: prompt.signal }) };
        const onAbort = () => this.settle(chatId, 'cancelled');
        pending.onAbort = onAbort;
        this.pending.set(chatId, pending);
        prompt.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            await this.send(chatId, formatApprovalPrompt(prompt));
        }
        catch {
            this.pending.delete(chatId);
            prompt.signal?.removeEventListener('abort', onAbort);
            return undefined;
        }
        return answer;
    }
    respond(chatId, decision) {
        const pending = this.pending.get(chatId);
        if (pending === undefined)
            return '当前没有待审批操作。';
        this.settle(chatId, decision === 'approve' ? 'allowed-once' : 'rejected');
        return decision === 'approve' ? '已批准本次操作。' : '已拒绝本次操作。';
    }
    settle(chatId, outcome) {
        const pending = this.pending.get(chatId);
        if (pending === undefined)
            return;
        this.pending.delete(chatId);
        if (pending.signal !== undefined && pending.onAbort !== undefined) {
            pending.signal.removeEventListener('abort', pending.onAbort);
        }
        pending.resolve(outcome);
    }
}
export async function handleApprovalRequest(approvals, request, next) {
    const call = request.callId === undefined ? undefined : request.agent.session.events.find(event => {
        if (event.type !== 'tool/call')
            return false;
        return (event.data ?? {}).callId === request.callId;
    });
    const args = (call?.data ?? {});
    const outcome = await approvals.request({
        sessionId: request.agent.session.id,
        toolName: request.toolName,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        ...(typeof args?.arguments === 'string' ? { arguments: args.arguments } : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return outcome ?? next();
}
export function formatApprovalPrompt(prompt) {
    const lines = [
        'Harness 请求审批',
        `工具：${prompt.toolName}`,
    ];
    if (prompt.reason !== undefined && prompt.reason.trim().length > 0)
        lines.push(`原因：${prompt.reason.trim()}`);
    if (prompt.arguments !== undefined && prompt.arguments.trim().length > 0) {
        const value = Array.from(prompt.arguments.trim()).slice(0, 2000).join('');
        lines.push(`参数：\n${value}${Array.from(prompt.arguments.trim()).length > 2000 ? '\n…' : ''}`);
    }
    lines.push('', '回复 /approve 批准本次操作，或 /reject 拒绝。');
    return lines.join('\n');
}
//# sourceMappingURL=approval.js.map