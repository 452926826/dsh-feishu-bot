export function completionNotificationTargets(configured, originatingChatId, activeChats) {
    const targets = new Set(configured);
    targets.add(originatingChatId);
    for (const chatId of activeChats) {
        if (chatId !== originatingChatId)
            targets.delete(chatId);
    }
    return targets;
}
//# sourceMappingURL=notifications.js.map