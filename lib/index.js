import { join } from 'node:path';
import { ApprovalCoordinator, handleApprovalRequest } from './approval.js';
import { readBindingView } from './binding-status.js';
import { FeishuCommandController } from './controller.js';
import { FeishuBot } from './feishu.js';
import { DshHarnessBridge, resolveProjectsRoot } from './harness.js';
import { loadCredentials, registerByQrCode, registrationErrorCode, removeCredentials, shouldRetryRegistration, } from './registration.js';
import { completionNotificationTargets } from './notifications.js';
import { JsonSelectionStore } from './state.js';
export const name = 'feishu-bot';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'webServer', 'approval'];
function csv(value) {
    return new Set((value ?? '').split(',').map(item => item.trim()).filter(Boolean));
}
function completionTargets() {
    return csv(process.env.FEISHU_NOTIFY_CHATS ?? process.env.FEISHU_ALLOWED_CHATS);
}
export function apply(ctx) {
    const logger = ctx.logger('feishu-bot');
    const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh');
    const pluginHome = join(home, 'feishu-bot');
    const credentialsPath = process.env.FEISHU_CREDENTIALS_PATH ?? join(pluginHome, 'credentials.json');
    const qrPath = process.env.FEISHU_QR_PATH ?? join(pluginHome, 'feishu-bind-qr.png');
    const projectsRoot = resolveProjectsRoot(process.env.FEISHU_PROJECTS_ROOT ?? process.cwd());
    const statePath = process.env.FEISHU_STATE_PATH ?? join(pluginHome, 'state.json');
    const abort = new AbortController();
    let bot;
    let websocket = 'disconnected';
    const activeChats = new Set();
    const approvals = new ApprovalCoordinator(async (chatId, text) => {
        if (bot === undefined)
            throw new Error('Feishu bot is not ready');
        await bot.sendText(chatId, text);
    });
    ctx.on('approval/request', (request, next) => {
        return handleApprovalRequest(approvals, request, next);
    }, { prepend: true });
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/plugins/feishu-binding/status',
        handler: async (_request, response) => {
            try {
                const environment = environmentCredentials();
                const view = await readBindingView({
                    credentialsPath,
                    qrPath,
                    websocket,
                    ...(environment === undefined ? {} : { environmentCredentials: environment }),
                });
                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json; charset=utf-8');
                response.setHeader('Cache-Control', 'no-store');
                response.end(JSON.stringify(view));
            }
            catch (error) {
                logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
                response.statusCode = 500;
                response.setHeader('Content-Type', 'application/json; charset=utf-8');
                response.end(JSON.stringify({ error: 'Failed to read Feishu binding status' }));
            }
        },
    }), 'feishu-bot: binding status route');
    const start = async () => {
        const environment = environmentCredentials();
        if (environment === undefined && process.env.FEISHU_REBIND === 'true') {
            await removeCredentials(credentialsPath);
            logger.info('removed saved Feishu credentials; starting a new QR binding');
        }
        const credentials = environment ?? await loadCredentials(credentialsPath) ?? await registerUntilComplete({
            credentialsPath,
            qrPath,
            logger,
            signal: abort.signal,
        });
        if (abort.signal.aborted)
            return;
        const selections = new JsonSelectionStore(statePath);
        let bridge;
        let controller;
        const notify = async ({ conversationId, chatId, reply }) => {
            const targets = completionNotificationTargets(completionTargets(), chatId, activeChats);
            const info = await bridge.conversationInfo(conversationId);
            const title = info?.name ?? conversationId;
            const text = `对话已完成：${title}\n${reply}\n\n回复 /uc 可直接进入最近完成的对话。`;
            await Promise.all([...targets].map(async (target) => {
                await controller.markConversationCompleted(target, conversationId);
                await bot?.sendText(target, text);
            }));
        };
        bridge = new DshHarnessBridge(ctx, projectsRoot, approvals, notify);
        controller = new FeishuCommandController(bridge, selections);
        bot = new FeishuBot({
            ...credentials,
            allowedChats: csv(process.env.FEISHU_ALLOWED_CHATS),
            allowedUsers: new Set(credentials.ownerOpenId === undefined ? [] : [credentials.ownerOpenId]),
            onMessage: async (message) => {
                activeChats.add(message.chatId);
                try {
                    return (await controller.handle(message.chatId, message.text)).text;
                }
                finally {
                    activeChats.delete(message.chatId);
                }
            },
            onReady: () => {
                websocket = 'connected';
                logger.info(`connected by WebSocket; projects root: ${projectsRoot}`);
            },
            onError: error => {
                websocket = 'error';
                logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
            },
            onReconnecting: () => {
                websocket = 'connecting';
                logger.warn('Feishu WebSocket disconnected; reconnecting');
            },
            pingTimeoutSeconds: 90,
        });
        websocket = 'connecting';
        bot.start();
    };
    ctx.effect(() => {
        void start().catch(error => {
            if (!abort.signal.aborted)
                logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
        });
        return async () => {
            abort.abort();
            await bot?.stop();
            websocket = 'disconnected';
        };
    }, 'feishu-bot: binding and websocket');
}
async function registerUntilComplete(options) {
    let attempt = 0;
    while (true) {
        attempt++;
        try {
            return await registerByQrCode(options);
        }
        catch (error) {
            if (!shouldRetryRegistration(error, attempt))
                throw error;
            const code = registrationErrorCode(error) ?? 'network_error';
            const delay = code === 'expired_token' ? 2_000 : Math.min(30_000, 2 ** attempt * 1_000);
            options.logger.warn(`Feishu binding failed (${code}); generating a new QR code in ${delay / 1000}s`);
            await abortableDelay(delay, options.signal);
        }
    }
}
function abortableDelay(ms, signal) {
    if (signal?.aborted === true)
        return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}
function environmentCredentials() {
    const appId = process.env.FEISHU_APP_ID?.trim();
    const appSecret = process.env.FEISHU_APP_SECRET?.trim();
    if (appId === undefined || appId.length === 0 || appSecret === undefined || appSecret.length === 0)
        return undefined;
    return { appId, appSecret };
}
export { FeishuCommandController } from './controller.js';
export { userMessage } from './harness.js';
export { isSenderAllowed, runWithThinkingMessage, splitText } from './feishu.js';
export { loadCredentials, registerByQrCode, registrationErrorCode, removeCredentials, renderTerminalQr, shouldRetryRegistration, validateCredentials, writeQrCode, } from './registration.js';
//# sourceMappingURL=index.js.map