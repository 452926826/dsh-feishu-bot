import type { FeishuCredentials } from './registration.js';
export type FeishuBindingView = {
    state: 'waiting';
    qrDataUrl: string;
    qrUpdatedAt: string;
    websocket: 'disconnected' | 'connecting' | 'connected' | 'error';
} | {
    state: 'bound';
    appIdMasked: string;
    ownerOpenIdMasked?: string;
    tenantBrand?: string;
    boundAt: string;
    websocket: 'disconnected' | 'connecting' | 'connected' | 'error';
} | {
    state: 'unavailable';
    websocket: 'disconnected' | 'connecting' | 'connected' | 'error';
};
export declare function maskIdentifier(value: string): string;
export declare function readBindingView(options: {
    credentialsPath: string;
    qrPath: string;
    websocket: FeishuBindingView['websocket'];
    environmentCredentials?: FeishuCredentials;
}): Promise<FeishuBindingView>;
//# sourceMappingURL=binding-status.d.ts.map