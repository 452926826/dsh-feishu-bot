import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as lark from '@larksuiteoapi/node-sdk';
import QRCode from 'qrcode';
export function registrationErrorCode(error) {
    if (typeof error !== 'object' || error === null || !('code' in error))
        return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}
export function shouldRetryRegistration(error, attempt) {
    const code = registrationErrorCode(error);
    if (code === 'access_denied' || code === 'abort')
        return false;
    if (code === 'expired_token')
        return true;
    return attempt < 3;
}
export async function removeCredentials(path) {
    await rm(path, { force: true });
}
export async function loadCredentials(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (typeof parsed.appId !== 'string' || parsed.appId.length === 0)
            return undefined;
        if (typeof parsed.appSecret !== 'string' || parsed.appSecret.length === 0)
            return undefined;
        return {
            appId: parsed.appId,
            appSecret: parsed.appSecret,
            ...(typeof parsed.userOpenId === 'string' ? { ownerOpenId: parsed.userOpenId } : {}),
        };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
export async function validateCredentials(credentials, createClient = options => new lark.Client(options)) {
    const client = createClient({ appId: credentials.appId, appSecret: credentials.appSecret });
    const response = await client.auth.v3.tenantAccessToken.internal({
        data: { app_id: credentials.appId, app_secret: credentials.appSecret },
    });
    const compatible = response;
    if (response.code !== 0 || (compatible.tenant_access_token === undefined && response.data?.tenant_access_token === undefined)) {
        throw new Error(`Feishu credential validation failed: ${response.msg ?? `code ${String(response.code)}`}`);
    }
}
export async function saveCredentials(path, credentials, userInfo) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    const stored = {
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        createdAt: new Date().toISOString(),
        ...(userInfo?.open_id === undefined && credentials.ownerOpenId === undefined
            ? {}
            : { userOpenId: userInfo?.open_id ?? credentials.ownerOpenId }),
        ...(userInfo?.tenant_brand === undefined ? {} : { tenantBrand: userInfo.tenant_brand }),
    };
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}
export async function registerByQrCode(options) {
    const result = await lark.registerApp({
        source: 'dsh-feishu-bot',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        createOnly: true,
        appPreset: {
            name: 'DeepSeek Harness',
            desc: '通过飞书与本机 DeepSeek Harness 对话',
        },
        addons: {
            preset: false,
            scopes: { tenant: ['im:message:send_as_bot'] },
            events: { items: { tenant: ['im.message.receive_v1'] } },
        },
        onQRCodeReady: info => {
            void Promise.all([
                writeQrCode(options.qrPath, info.url),
                process.env.FEISHU_QR_TERMINAL === 'false' ? Promise.resolve(undefined) : renderTerminalQr(info.url),
            ]).then(([, terminal]) => {
                options.logger.info(`scan Feishu QR code: ${options.qrPath}`);
                if (terminal !== undefined)
                    options.logger.info(`\n${terminal}`);
                options.logger.info(`binding link (expires in ${info.expireIn}s): ${info.url}`);
            }).catch(error => options.logger.warn(`failed to render QR code: ${String(error)}`));
        },
        onStatusChange: info => {
            options.logger.info(`Feishu binding status: ${info.status}`);
        },
    });
    const credentials = {
        appId: result.client_id,
        appSecret: result.client_secret,
        ...(result.user_info?.open_id === undefined ? {} : { ownerOpenId: result.user_info.open_id }),
    };
    await saveCredentials(options.credentialsPath, credentials, result.user_info);
    await rm(options.qrPath, { force: true });
    options.logger.info(`Feishu binding complete; credentials saved to ${options.credentialsPath}`);
    try {
        await validateCredentials(credentials);
        options.logger.info('Feishu credentials validated with the tenant token API');
    }
    catch (error) {
        options.logger.warn(`Feishu credentials were saved but tenant token validation failed: ${String(error)}`);
    }
    return credentials;
}
export async function renderTerminalQr(url) {
    return QRCode.toString(url, { type: 'terminal', small: true });
}
export async function writeQrCode(path, url) {
    await mkdir(dirname(path), { recursive: true });
    await QRCode.toFile(path, url, {
        type: 'png',
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'M',
    });
    await chmod(path, 0o600);
}
//# sourceMappingURL=registration.js.map