import { readFile, stat } from 'node:fs/promises';
export function maskIdentifier(value) {
    if (value.length <= 8)
        return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
export async function readBindingView(options) {
    const stored = await readStoredCredentials(options.credentialsPath);
    const credentials = stored ?? (options.environmentCredentials === undefined ? undefined : {
        appId: options.environmentCredentials.appId,
        userOpenId: options.environmentCredentials.ownerOpenId,
        createdAt: undefined,
        tenantBrand: undefined,
    });
    if (credentials !== undefined) {
        return {
            state: 'bound',
            appIdMasked: maskIdentifier(credentials.appId),
            ...(credentials.userOpenId === undefined ? {} : { ownerOpenIdMasked: maskIdentifier(credentials.userOpenId) }),
            ...(credentials.tenantBrand === undefined ? {} : { tenantBrand: credentials.tenantBrand }),
            boundAt: credentials.createdAt ?? 'environment',
            websocket: options.websocket,
        };
    }
    try {
        const [image, info] = await Promise.all([readFile(options.qrPath), stat(options.qrPath)]);
        return {
            state: 'waiting',
            qrDataUrl: `data:image/png;base64,${image.toString('base64')}`,
            qrUpdatedAt: info.mtime.toISOString(),
            websocket: options.websocket,
        };
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        return { state: 'unavailable', websocket: options.websocket };
    }
}
async function readStoredCredentials(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (typeof parsed.appId !== 'string' || parsed.appId.length === 0)
            return undefined;
        return {
            appId: parsed.appId,
            ...(typeof parsed.userOpenId === 'string' ? { userOpenId: parsed.userOpenId } : {}),
            ...(typeof parsed.tenantBrand === 'string' ? { tenantBrand: parsed.tenantBrand } : {}),
            ...(typeof parsed.createdAt === 'string' ? { createdAt: parsed.createdAt } : {}),
        };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
//# sourceMappingURL=binding-status.js.map