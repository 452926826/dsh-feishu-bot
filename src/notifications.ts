export function completionNotificationTargets(
  configured: ReadonlySet<string>,
  originatingChatId: string,
  activeChats: ReadonlySet<string>,
): Set<string> {
  const targets = new Set(configured)
  targets.add(originatingChatId)
  for (const chatId of activeChats) {
    if (chatId !== originatingChatId) targets.delete(chatId)
  }
  return targets
}
