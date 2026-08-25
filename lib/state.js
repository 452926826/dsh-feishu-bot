import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class JsonSelectionStore {
    path;
    loaded;
    writeTail = Promise.resolve();
    constructor(path) {
        this.path = path;
    }
    async get(chatId) {
        const state = await this.load();
        return { ...(state.chats[chatId] ?? {}) };
    }
    async set(chatId, selection) {
        const state = await this.load();
        state.chats[chatId] = { ...selection };
        this.writeTail = this.writeTail.then(() => this.persist(state));
        await this.writeTail;
    }
    load() {
        this.loaded ??= readFile(this.path, 'utf8')
            .then(text => JSON.parse(text))
            .catch((error) => {
            if (error.code === 'ENOENT')
                return { chats: {} };
            throw error;
        });
        return this.loaded;
    }
    async persist(state) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
    }
}
//# sourceMappingURL=state.js.map