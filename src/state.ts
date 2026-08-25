import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ChatSelection, SelectionStore } from './controller.js'

interface StateFile {
  chats: Record<string, ChatSelection>
}

export class JsonSelectionStore implements SelectionStore {
  private loaded: Promise<StateFile> | undefined
  private writeTail = Promise.resolve()

  constructor(private readonly path: string) {}

  async get(chatId: string): Promise<ChatSelection> {
    const state = await this.load()
    return { ...(state.chats[chatId] ?? {}) }
  }

  async set(chatId: string, selection: ChatSelection): Promise<void> {
    const state = await this.load()
    state.chats[chatId] = { ...selection }
    this.writeTail = this.writeTail.then(() => this.persist(state))
    await this.writeTail
  }

  private load(): Promise<StateFile> {
    this.loaded ??= readFile(this.path, 'utf8')
      .then(text => JSON.parse(text) as StateFile)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return { chats: {} }
        throw error
      })
    return this.loaded
  }

  private async persist(state: StateFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
  }
}
