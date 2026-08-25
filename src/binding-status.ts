import { readFile, stat } from 'node:fs/promises'
import type { FeishuCredentials } from './registration.js'

export type FeishuBindingView =
  | {
      state: 'waiting'
      qrDataUrl: string
      qrUpdatedAt: string
      websocket: 'disconnected' | 'connecting' | 'connected' | 'error'
    }
  | {
      state: 'bound'
      appIdMasked: string
      ownerOpenIdMasked?: string
      tenantBrand?: string
      boundAt: string
      websocket: 'disconnected' | 'connecting' | 'connected' | 'error'
    }
  | {
      state: 'unavailable'
      websocket: 'disconnected' | 'connecting' | 'connected' | 'error'
    }

interface StoredCredentials {
  appId?: unknown
  userOpenId?: unknown
  tenantBrand?: unknown
  createdAt?: unknown
}

export function maskIdentifier(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export async function readBindingView(options: {
  credentialsPath: string
  qrPath: string
  websocket: FeishuBindingView['websocket']
  environmentCredentials?: FeishuCredentials
}): Promise<FeishuBindingView> {
  const stored = await readStoredCredentials(options.credentialsPath)
  const credentials = stored ?? (options.environmentCredentials === undefined ? undefined : {
    appId: options.environmentCredentials.appId,
    userOpenId: options.environmentCredentials.ownerOpenId,
    createdAt: undefined,
    tenantBrand: undefined,
  })
  if (credentials !== undefined) {
    return {
      state: 'bound',
      appIdMasked: maskIdentifier(credentials.appId),
      ...(credentials.userOpenId === undefined ? {} : { ownerOpenIdMasked: maskIdentifier(credentials.userOpenId) }),
      ...(credentials.tenantBrand === undefined ? {} : { tenantBrand: credentials.tenantBrand }),
      boundAt: credentials.createdAt ?? 'environment',
      websocket: options.websocket,
    }
  }
  try {
    const [image, info] = await Promise.all([readFile(options.qrPath), stat(options.qrPath)])
    return {
      state: 'waiting',
      qrDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      qrUpdatedAt: info.mtime.toISOString(),
      websocket: options.websocket,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { state: 'unavailable', websocket: options.websocket }
  }
}

async function readStoredCredentials(path: string): Promise<{
  appId: string
  userOpenId?: string
  tenantBrand?: string
  createdAt?: string
} | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as StoredCredentials
    if (typeof parsed.appId !== 'string' || parsed.appId.length === 0) return undefined
    return {
      appId: parsed.appId,
      ...(typeof parsed.userOpenId === 'string' ? { userOpenId: parsed.userOpenId } : {}),
      ...(typeof parsed.tenantBrand === 'string' ? { tenantBrand: parsed.tenantBrand } : {}),
      ...(typeof parsed.createdAt === 'string' ? { createdAt: parsed.createdAt } : {}),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
