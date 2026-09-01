# Changelog

## Unreleased

- Added one-based project index selection with `/up + index` while preserving exact-name selection.
- Added completion notifications for every conversation, configurable with `FEISHU_NOTIFY_CHATS`.
- Added bare `/uc` to enter the most recently completed conversation from a notification.
- Enabled Feishu SDK heartbeat detection and automatic reconnect after transient WebSocket failures.
- Suppressed unrelated completion notifications while a chat is actively processing another conversation.

## 0.1.4

- Added QR-code application creation and credential binding.
- Added Feishu project and conversation routing over WebSocket.
- Added chat-scoped tool approval and rejection commands.
- Added a Web settings view with masked binding information.
- Added installable DSH Bundle metadata and marketplace validation.
