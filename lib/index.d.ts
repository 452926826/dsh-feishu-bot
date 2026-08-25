import type { Context } from '@deepseek-ai/cordis';
export declare const name = "feishu-bot";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
export { FeishuCommandController } from './controller.js';
export { userMessage } from './harness.js';
export { isSenderAllowed, runWithThinkingMessage, splitText } from './feishu.js';
export { loadCredentials, registerByQrCode, registrationErrorCode, removeCredentials, renderTerminalQr, shouldRetryRegistration, validateCredentials, writeQrCode, } from './registration.js';
//# sourceMappingURL=index.d.ts.map