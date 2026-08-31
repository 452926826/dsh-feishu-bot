# dsh-feishu-bot

[English](README.md) | 简体中文

通过飞书应用机器人 WebSocket 长连接使用 DeepSeek Harness，不需要公网回调地址。首次启动可通过二维码一键创建并绑定飞书应用，无需手工复制 App ID/Secret。

## 扫码绑定

插件未找到现有凭据时会自动调用飞书官方 OAuth 2.0 Device Authorization Grant 一键创建应用流程，在 DSH 终端日志直接显示二维码，并生成：

```text
~/.dsh/feishu-bot/feishu-bind-qr.png
```

使用飞书扫描二维码，在确认页创建并授权应用。扫码用户必须有所在租户创建企业自建应用的权限。二维码通常在约 10 分钟后过期；过期后重启 DSH 会生成新的二维码。

扫码确认后，插件会：

1. 申请机器人发送消息权限 `im:message:send_as_bot`。
2. 订阅接收消息事件 `im.message.receive_v1`。
3. 立即将飞书返回的凭据和扫码者 `open_id` 以 `0600` 权限保存到 `~/.dsh/feishu-bot/credentials.json`，再调用 tenant token API 验证；后置验证失败会记录警告，但不会丢弃已创建应用的凭据或重复创建机器人。
4. 默认只允许扫码者向机器人发指令；可通过 `FEISHU_ALLOWED_CHATS` 额外开放指定群聊。
5. 删除已使用的二维码并立即连接飞书 WebSocket。

创建完成后，按飞书确认页指引发布应用，将机器人加入群聊或与机器人单聊。无需公网回调地址。

## 指令

- `/lp`：列出所有项目
- `/up + 项目名或索引`：按项目名或 `/lp` 显示的一基索引进入已有项目，例如 `/up + 2`
- `/np + 项目名`：在项目根目录创建并进入新项目
- `/lc`：按从 1 开始的索引列出当前项目全部对话
- `/uc`：直接进入最近完成的对话，并返回最近 2 条用户/助手消息
- `/uc + 索引`：按 `/lc` 显示的索引进入对话，并返回最近 2 条用户/助手消息
- `/nc`：在当前项目创建并进入新对话
- `/approve`：批准当前待审批操作一次
- `/reject`：拒绝当前待审批操作
- `/批准`、`/拒绝`：上述命令的中文别名
- `/help`：显示帮助
- 其他文本：发送到当前 Harness 对话，并把最终回答发回飞书

收到指令后，机器人会立即发送“思考中…”占位消息；Harness 完成后会把该消息更新为回答。回答超过 3500 个 Unicode 字符时自动拆分为多条消息，优先在换行处切分，不会切断 emoji 等 Unicode 字符。

当当前对话中的工具需要审批时，机器人会主动发送工具名、原因和参数摘要。仅发起该 Harness 对话的飞书会话可以回复 `/approve`（只批准本次）或 `/reject`；发送失败、超时和没有对应飞书会话时均拒绝或交给其他已配置的审批渠道处理。

项目和对话选择按飞书 `chat_id` 隔离，并持久化到 `$DSH_HOME/feishu-bot/state.json`。每个对话完成后，机器人会向发起 chat 发送完成通知；配置 `FEISHU_NOTIFY_CHATS` 后也会广播给指定 chat。通知中回复 `/uc` 可直接进入最近完成的对话。

## 环境变量

二维码绑定不需要配置 App ID/Secret。可选配置：

```bash
export FEISHU_PROJECTS_ROOT='/absolute/path/to/projects'
# 推荐：只允许这些飞书 chat_id 操作 Harness，逗号分隔。
export FEISHU_ALLOWED_CHATS='oc_xxx,oc_yyy'
# 可选：向这些 chat 广播任意 Harness 对话完成通知；默认至少通知发起对话的 chat。
export FEISHU_NOTIFY_CHATS='oc_ops,oc_owner'
```

仍支持手工凭据，环境变量的优先级高于扫码保存的凭据：

```bash
export FEISHU_APP_ID='cli_xxx'
export FEISHU_APP_SECRET='xxx'
```

其他可选变量：

- `FEISHU_CREDENTIALS_PATH`：扫码凭据文件路径
- `FEISHU_QR_PATH`：二维码 PNG 输出路径
- `FEISHU_QR_TERMINAL=false`：不在终端日志显示二维码（默认显示）
- `FEISHU_REBIND=true`：下次启动时删除已保存的本地凭据并重新扫码绑定；成功后应移除该变量
- `FEISHU_STATE_PATH`：项目和对话选择状态文件路径
- `DSH_HOME`：Harness 数据目录，默认 `~/.dsh`

## 安装

将发布归档复制到目标机器后安装：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-feishu-bot-0.1.4.tgz
```

如果安装提示 `Ignored build scripts: protobufjs`，编辑目标 profile 的 `pnpm-workspace.yaml`，加入：

```yaml
allowBuilds:
  protobufjs: true
```

然后重新运行安装命令。默认 profile 文件位于 `~/.dsh/profiles/web/pnpm-workspace.yaml`。

安装完成后重启 Harness：

```bash
dsh web
```

插件包含 Host 和 Web 客户端两侧。安装并启用插件后，Harness 的“设置 → 插件”中会出现“飞书配置”；卸载或禁用插件后该入口消失。未绑定时页面显示二维码，已绑定时只显示脱敏绑定信息。每台机器默认使用自己的 `~/.dsh/feishu-bot/credentials.json`，目标机器应重新扫码绑定，不要将源机器的 App Secret 或凭据文件放进插件归档。

从源码开发安装：

```bash
npm install
npm run check
dsh plugin --profile web add .
```

也可以直接从 GitHub 安装：

```bash
dsh plugin --profile web add github:452926826/dsh-feishu-bot
```

查看当前绑定状态（不会读取或输出 App Secret）：

```bash
npm run binding:status
```

状态为 `waiting-for-scan-confirmation` 表示二维码已经生成，但飞书页面还没有完成最终确认；`bound` 表示凭据已经落盘。

## 安全

二维码包含短时设备授权凭据，在完成绑定前不要发给无权创建应用的人。长期 App Secret 只存于本机凭据文件，不写入二维码、仓库或 `cordis.patch.yml`。

机器人收到的普通文本会作为用户指令提交给 Harness，权限等同于当前 DSH profile。生产使用应配置 `FEISHU_ALLOWED_CHATS`；否则任何能联系机器人的飞书 chat 都可操作 Harness。
