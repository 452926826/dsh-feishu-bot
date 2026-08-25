import type { ChatSelection, SelectionStore } from './controller.js';
export declare class JsonSelectionStore implements SelectionStore {
    private readonly path;
    private loaded;
    private writeTail;
    constructor(path: string);
    get(chatId: string): Promise<ChatSelection>;
    set(chatId: string, selection: ChatSelection): Promise<void>;
    private load;
    private persist;
}
//# sourceMappingURL=state.d.ts.map