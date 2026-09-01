export interface FeishuInboundMessage {
    chatId: string;
    messageId: string;
    senderOpenId?: string;
    text: string;
}
export interface FeishuBotOptions {
    appId: string;
    appSecret: string;
    allowedChats: ReadonlySet<string>;
    allowedUsers: ReadonlySet<string>;
    onMessage(message: FeishuInboundMessage): Promise<string>;
    onReady?(): void;
    onError(error: unknown): void;
    onReconnecting?(): void;
    pingTimeoutSeconds?: number;
}
export declare class FeishuBot {
    private readonly options;
    private readonly client;
    private readonly ws;
    private readonly dispatcher;
    private readonly seen;
    private stopped;
    constructor(options: FeishuBotOptions);
    start(): void;
    stop(): Promise<void>;
    sendText(chatId: string, text: string): Promise<void>;
    private receive;
    private send;
    private sendOne;
    private update;
}
export declare function runWithThinkingMessage(options: {
    onMessage(): Promise<string>;
    sendThinking(): Promise<string | undefined>;
    update(messageId: string, text: string): Promise<void>;
    send(text: string): Promise<void>;
    onError(error: unknown): void;
}): Promise<void>;
export declare function isSenderAllowed(chatId: string, senderOpenId: string | undefined, allowedChats: ReadonlySet<string>, allowedUsers: ReadonlySet<string>): boolean;
export declare function splitText(text: string, maxLength: number): string[];
//# sourceMappingURL=feishu.d.ts.map