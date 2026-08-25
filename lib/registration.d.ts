import * as lark from '@larksuiteoapi/node-sdk';
export interface FeishuCredentials {
    appId: string;
    appSecret: string;
    ownerOpenId?: string;
}
export type RegistrationErrorCode = 'access_denied' | 'expired_token' | 'abort' | string;
export interface RegistrationLogger {
    info(message: string): void;
    warn(message: string): void;
}
export declare function registrationErrorCode(error: unknown): RegistrationErrorCode | undefined;
export declare function shouldRetryRegistration(error: unknown, attempt: number): boolean;
export declare function removeCredentials(path: string): Promise<void>;
export declare function loadCredentials(path: string): Promise<FeishuCredentials | undefined>;
export declare function validateCredentials(credentials: FeishuCredentials, createClient?: (options: {
    appId: string;
    appSecret: string;
}) => Pick<lark.Client, 'auth'>): Promise<void>;
export declare function saveCredentials(path: string, credentials: FeishuCredentials, userInfo?: {
    open_id?: string;
    tenant_brand?: string;
}): Promise<void>;
export declare function registerByQrCode(options: {
    credentialsPath: string;
    qrPath: string;
    logger: RegistrationLogger;
    signal?: AbortSignal;
}): Promise<FeishuCredentials>;
export declare function renderTerminalQr(url: string): Promise<string>;
export declare function writeQrCode(path: string, url: string): Promise<void>;
//# sourceMappingURL=registration.d.ts.map