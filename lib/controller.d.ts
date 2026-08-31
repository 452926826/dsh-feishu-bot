export interface ProjectInfo {
    id: string;
    name: string;
    path: string;
}
export interface ConversationInfo {
    id: string;
    name: string;
}
export interface ChatSelection {
    projectId?: string;
    conversationId?: string;
    lastCompletedConversationId?: string;
}
export interface HarnessBridge {
    listProjects(): Promise<ProjectInfo[]>;
    createProject(name: string): Promise<ProjectInfo>;
    listConversations(projectId: string): Promise<ConversationInfo[]>;
    createConversation(projectId: string): Promise<ConversationInfo>;
    recentMessages(conversationId: string, count: number): Promise<string[]>;
    conversationInfo(conversationId: string): Promise<ConversationInfo | undefined>;
    converse(conversationId: string, text: string, chatId: string): Promise<string>;
    respondToApproval(chatId: string, decision: 'approve' | 'reject'): string;
}
export interface SelectionStore {
    get(chatId: string): Promise<ChatSelection>;
    set(chatId: string, selection: ChatSelection): Promise<void>;
}
export type ConversationCompleted = {
    conversationId: string;
    chatId: string;
};
export type ControllerResult = {
    text: string;
    selection?: ChatSelection;
};
export declare class FeishuCommandController {
    private readonly bridge;
    private readonly selections;
    constructor(bridge: HarnessBridge, selections: SelectionStore);
    markConversationCompleted(chatId: string, conversationId: string): Promise<void>;
    handle(chatId: string, input: string): Promise<ControllerResult>;
}
//# sourceMappingURL=controller.d.ts.map