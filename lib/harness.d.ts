import type { Context } from '@deepseek-ai/cordis';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionStore } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { ConversationInfo, HarnessBridge, ProjectInfo } from './controller.js';
interface ApprovalRouter {
    bind(sessionId: string, chatId: string): {
        dispose(): void;
    };
    respond(chatId: string, decision: 'approve' | 'reject'): string;
}
interface HarnessContext extends Context {
    agents: AgentRegistry;
    sessions: SessionStore;
    workspaceRegistry: WorkspaceRegistry;
    sessionPersistence: SessionPersistence;
}
export declare function userMessage(text: string): UserMessage;
export interface ConversationCompletedEvent {
    conversationId: string;
    chatId: string;
    reply: string;
}
export declare class DshHarnessBridge implements HarnessBridge {
    private readonly ctx;
    private readonly projectsRoot;
    private readonly approvals;
    private readonly onCompleted?;
    private readonly handles;
    private readonly queues;
    constructor(ctx: HarnessContext, projectsRoot: string, approvals: ApprovalRouter, onCompleted?: ((event: ConversationCompletedEvent) => Promise<void> | void) | undefined);
    listProjects(): Promise<ProjectInfo[]>;
    createProject(name: string): Promise<ProjectInfo>;
    listConversations(projectId: string): Promise<ConversationInfo[]>;
    createConversation(projectId: string): Promise<ConversationInfo>;
    conversationInfo(conversationId: string): Promise<ConversationInfo | undefined>;
    recentMessages(conversationId: string, count: number): Promise<string[]>;
    converse(conversationId: string, text: string, chatId: string): Promise<string>;
    respondToApproval(chatId: string, decision: 'approve' | 'reject'): string;
    private runConversation;
    private ensureAgent;
    private safeProjectName;
}
export declare function resolveProjectsRoot(value: string): string;
export {};
//# sourceMappingURL=harness.d.ts.map