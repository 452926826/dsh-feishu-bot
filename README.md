# dsh-feishu-bot

English | [简体中文](README.zh-CN.md)

Use DeepSeek Harness through a Feishu application bot over a WebSocket long connection, without exposing a public callback URL. On first start, the plugin can create and bind a Feishu application through a QR code, so App ID and App Secret do not need to be copied manually.

## QR-code binding

When no credentials are available, the plugin starts Feishu's OAuth 2.0 Device Authorization Grant application-creation flow, renders a QR code in the DSH terminal, and writes it to:

```text
~/.dsh/feishu-bot/feishu-bind-qr.png
```

Scan the code in Feishu and create and authorize the application on the confirmation page. The scanning user must have permission to create a custom application in the tenant. The QR code normally expires after about ten minutes; restart DSH to generate another one.

After confirmation, the plugin:

1. Requests the `im:message:send_as_bot` permission.
2. Subscribes to `im.message.receive_v1` events.
3. Saves the returned credentials and the scanner's `open_id` to `~/.dsh/feishu-bot/credentials.json` with mode `0600`, then validates them with the tenant token API. A post-creation validation failure is logged but does not discard the credentials or create another bot.
4. Allows only the scanning user by default. Additional group chats can be allowed through `FEISHU_ALLOWED_CHATS`.
5. Deletes the consumed QR code and connects to Feishu WebSocket immediately.

Publish the application as instructed by Feishu, then add the bot to a group or start a direct conversation. No public callback URL is required.

## Commands

- `/lp`: list projects
- `/up + project name or index`: select an existing project by name or by the one-based index shown by `/lp`, for example `/up + 2`
- `/np + project name`: create and select a project under the projects root
- `/lc`: list conversations in the current project with one-based indexes
- `/uc`: enter the most recently completed conversation and return its two latest user/assistant messages
- `/uc + index`: select a conversation by the index shown by `/lc` and return its two latest user/assistant messages
- `/nc`: create and select a conversation in the current project
- `/approve`: approve the current pending operation once
- `/reject`: reject the current pending operation
- `/批准` and `/拒绝`: Chinese aliases for approval and rejection
- `/help`: show help
- Any other text: send it to the active Harness conversation and return the final answer to Feishu

The bot first sends a thinking placeholder and updates it with the final answer. Replies longer than 3,500 Unicode characters are split into multiple messages at newline boundaries when possible, without splitting Unicode code points. The Feishu WebSocket uses the SDK's automatic reconnect and heartbeat watchdog so short disconnects and half-open idle connections recover automatically.

When a tool requests approval, the bot sends the tool name, reason, and an argument summary. Only the Feishu chat that initiated the Harness conversation can answer with `/approve` or `/reject`. Failed delivery, timeouts, and conversations without a Feishu route are rejected or passed to another configured approval channel.

Project and conversation selections are isolated by Feishu `chat_id` and persisted in `$DSH_HOME/feishu-bot/state.json`. After every conversation completes, the bot notifies the originating chat; `FEISHU_NOTIFY_CHATS` can broadcast the notification to additional chats. A chat that is currently processing a message is excluded from completion notifications for other conversations, avoiding interruptions. Reply `/uc` to enter the most recently completed conversation directly.

## Environment variables

QR binding does not require App ID or App Secret. Optional settings:

```bash
export FEISHU_PROJECTS_ROOT='/absolute/path/to/projects'
# Recommended: comma-separated Feishu chat IDs allowed to operate Harness.
export FEISHU_ALLOWED_CHATS='oc_xxx,oc_yyy'
# Optional: broadcast every completed Harness conversation to these chats.
# The originating chat is always notified as well.
export FEISHU_NOTIFY_CHATS='oc_ops,oc_owner'
```

Manual credentials are still supported and take precedence over saved QR-binding credentials:

```bash
export FEISHU_APP_ID='cli_xxx'
export FEISHU_APP_SECRET='xxx'
```

Other optional variables:

- `FEISHU_CREDENTIALS_PATH`: saved credential file path
- `FEISHU_QR_PATH`: QR-code PNG output path
- `FEISHU_QR_TERMINAL=false`: disable terminal QR rendering
- `FEISHU_REBIND=true`: delete saved credentials and bind again on the next start; remove it after successful binding
- `FEISHU_STATE_PATH`: project and conversation selection state path
- `DSH_HOME`: Harness data directory, defaulting to `~/.dsh`

## Installation

Install a release archive copied to the target machine:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-feishu-bot-0.1.4.tgz
```

If installation reports `Ignored build scripts: protobufjs`, edit the target profile's `pnpm-workspace.yaml` and add:

```yaml
allowBuilds:
  protobufjs: true
```

Then repeat the installation. The default profile file is `~/.dsh/profiles/web/pnpm-workspace.yaml`.

Restart Harness after installation:

```bash
dsh web
```

The package contains both Host and Web client plugins. When enabled, a Feishu configuration entry appears under Harness Settings > Plugins. An unbound installation displays the QR code; a bound installation only displays masked binding information. Each machine uses its own `~/.dsh/feishu-bot/credentials.json` by default. Bind again on the target machine and never include App Secret or credential files in the plugin archive.

Install from source for development:

```bash
npm install
npm run check
dsh plugin --profile web add .
```

It can also be installed directly from GitHub:

```bash
dsh plugin --profile web add github:452926826/dsh-feishu-bot
```

Inspect the current binding state without reading or printing App Secret:

```bash
npm run binding:status
```

`waiting-for-scan-confirmation` means a QR code exists but the Feishu confirmation flow is incomplete. `bound` means credentials have been saved.

## Security

The QR code contains short-lived device authorization credentials. Do not share it with anyone who should not be able to create an application. The long-lived App Secret remains in the local credential file and is never written to the QR code, repository, or `cordis.patch.yml`.

Ordinary bot messages are submitted to Harness as user instructions and have the same effective permissions as the active DSH profile. Configure `FEISHU_ALLOWED_CHATS` in production; otherwise, any Feishu chat that can contact the bot may operate Harness.
