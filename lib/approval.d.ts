export type ApprovalDecision = 'approve' | 'reject';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled';
export interface ApprovalPrompt {
    sessionId: string;
    toolName: string;
    reason?: string;
    arguments?: string;
    signal?: AbortSignal;
}
export declare class ApprovalCoordinator {
    private readonly send;
    private readonly routes;
    private readonly pending;
    constructor(send: (chatId: string, text: string) => Promise<unknown>);
    bind(sessionId: string, chatId: string): {
        dispose(): void;
    };
    request(prompt: ApprovalPrompt): Promise<ApprovalOutcome | undefined>;
    hasRoute(sessionId: string): boolean;
    respond(chatId: string, decision: ApprovalDecision): string;
    private settle;
}
interface HarnessApprovalRequest {
    agent: {
        session: {
            id: string;
        };
    };
    toolName: string;
    callId?: unknown;
    reason?: string;
    signal?: AbortSignal;
}
interface ToolCallEvent {
    type: string;
    data?: unknown;
}
export declare function handleApprovalRequest(approvals: ApprovalCoordinator, request: HarnessApprovalRequest, next: () => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>, readSession: (id: string) => Promise<{
    events: readonly ToolCallEvent[];
}>): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>;
export declare function formatApprovalPrompt(prompt: ApprovalPrompt): string;
export {};
//# sourceMappingURL=approval.d.ts.map