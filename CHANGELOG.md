# Changelog

## Unreleased

- Render replies as interactive cards again, so Markdown headings, tables and code blocks keep their formatting; the 0.2.2 rewrite had fallen back to plain text messages. Card creation degrades to plain text when Feishu rejects the payload, and the thinking placeholder is patched in place.
- Report why a turn stopped. A failed turn used to answer "Harness 已处理消息，但没有返回文本内容。" and hide the provider error; it now prefixes `⚠️ 本轮执行失败：` with the underlying message and code, and appends the reason to partial replies.
- Authenticate binding status requests through DSH connection and never expose QR images over HTTP or in logs.
- Require an allowed Feishu user and, when configured, an allowed chat; manual credentials now require `FEISHU_ALLOWED_USERS`.
- Serialize QR writes and clean up after registration, and give environment credentials precedence in binding status.

## 0.1.5

- Migrated session history and titles to the DSH session-query service and aligned approval handling with DSH 0.2.2-rc.1.
- Require DSH >=0.2.2-rc.1 and <0.3.0-0; added offline Cordis lifecycle and approval regression coverage.
- Prevent a cancelled approval delivery from removing a later pending approval.

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
