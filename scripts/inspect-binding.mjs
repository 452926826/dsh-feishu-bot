#!/usr/bin/env node
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
const pluginHome = join(home, 'feishu-bot')
const credentials = process.env.FEISHU_CREDENTIALS_PATH ?? join(pluginHome, 'credentials.json')
const qr = process.env.FEISHU_QR_PATH ?? join(pluginHome, 'feishu-bind-qr.png')

const credentialsInfo = await fileInfo(credentials)
const qrInfo = await fileInfo(qr)

console.log(JSON.stringify({
  credentials: credentialsInfo,
  qr: qrInfo,
  state: credentialsInfo.exists
    ? 'bound'
    : qrInfo.exists
      ? 'waiting-for-scan-confirmation'
      : 'not-started',
}, null, 2))

async function fileInfo(path) {
  try {
    await access(path, constants.R_OK)
    const info = await stat(path)
    return {
      path,
      exists: true,
      mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
      updatedAt: info.mtime.toISOString(),
      ageSeconds: Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000)),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, exists: false }
    throw error
  }
}
