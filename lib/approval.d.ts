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
    respond(chatId: string, decision: ApprovalDecision): string;
    private settle;
}
interface HarnessApprovalRequest {
    agent: {
        session: {
            id: string;
            events: ReadonlyArray<{
                type: string;
                data?: unknown;
            }>;
        };
    };
    toolName: string;
    callId?: unknown;
    reason?: string;
    signal?: AbortSignal;
}
export declare function handleApprovalRequest(approvals: ApprovalCoordinator, request: HarnessApprovalRequest, next: () => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>;
export declare function formatApprovalPrompt(prompt: ApprovalPrompt): string;
export {};
//# sourceMappingURL=approval.d.ts.map