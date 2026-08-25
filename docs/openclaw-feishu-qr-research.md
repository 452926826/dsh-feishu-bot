# OpenClaw 飞书扫码建应用与绑定机制研究

> 研究时间：2026-08-21。OpenClaw 源码分析固定在提交 `1089253ca97c86bc8ef5df139c1c672d27ce59f4`，避免 `main` 后续变化造成引用漂移。

## 结论摘要

OpenClaw 的“生成飞书二维码，飞书扫描后绑定”准确说法是：**通过飞书 Accounts 服务提供的设备码式“一键创建自建应用”流程，由当前飞书/Lark 手机用户扫码确认创建一个 PersonalAgent 应用；OpenClaw 随后用本地保存的 `device_code` 轮询，取得新应用的 `client_id`、`client_secret` 和扫码用户的 `open_id`，把前两者保存为 Feishu channel 的 App ID/App Secret，并把扫码者加入 DM allowlist。**

它不是以下三种东西：

1. 不是把 App Secret 或 access token 编进二维码；二维码内容是飞书 Accounts 返回的短期 `verification_uri_complete` URL。
2. 不是标准“用户 OAuth 登录后拿 `user_access_token`”流程；此流程最终返回应用凭证，而非用户 access/refresh token。
3. 不是 OpenClaw 的 DM pairing code。DM pairing 是机器人上线后，未知用户发私信时的另一套访问控制流程。

二维码并没有消除 App ID/Secret。它只是让飞书在扫码确认后自动创建应用并把凭证交回本地 OpenClaw。机器人运行阶段仍依赖该 App ID/Secret。源码中没有 OpenClaw 自有云或中继参与；但必然依赖飞书/Lark 的 Accounts、OpenAPI 和 WebSocket 云服务。

## 1. 项目和一手来源

准确官方仓库是 [openclaw/openclaw](https://github.com/openclaw/openclaw)。本研究使用以下固定版本一手来源：

- [官方 Feishu channel 文档](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/docs/channels/feishu.md)：说明 `openclaw channels login --channel feishu`、手工 App ID/Secret 和 QR 自动建 bot 两种方式；默认 WebSocket，可选 webhook；DM/group 策略和泄密处置。
- [二维码注册实现 `app-registration.ts`](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/extensions/feishu/src/app-registration.ts#L1-L276)：Accounts 域名、请求参数、二维码 URL、轮询状态机、凭证返回和 owner 查询。
- [向导实现 `setup-surface.ts`](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/extensions/feishu/src/setup-surface.ts#L1-L358)：选择 scan/manual、打印 QR、保存 App ID/Secret、设置 WebSocket 和 allowlist。
- [QR 修复提交](https://github.com/openclaw/openclaw/commit/1089253ca97c86bc8ef5df139c1c672d27ce59f4)：明确测试用例名称为 “scan-to-create QR”，且二维码样例是 `https://accounts.feishu.cn/verify?device_code=...`；修复只改变终端二维码渲染尺寸。
- [事件传输实现 `monitor.transport.ts`](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/extensions/feishu/src/monitor.transport.ts)：官方 Node SDK WebSocket、重连，以及 webhook 签名、限流、body 限制和 challenge 处理。
- [客户端实现 `client.ts`](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/extensions/feishu/src/client.ts)：用 App ID/App Secret 创建 `@larksuiteoapi/node-sdk` Client/WSClient。

飞书一手资料：

- [飞书：网页应用扫码登录简介](https://open.feishu.cn/document/qr-code-scanning-login-for-web-app/introduction)：标准用户登录二维码的官方说明，用于对比本机制；扫码主体是飞书用户，授权后应用取得用户身份授权。
- [飞书：获取 user_access_token](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)：标准 authorization code 换用户 token 的服务端接口。
- [飞书：自建应用获取 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)：App ID/App Secret 换租户 token。
- [飞书：自建应用获取 app_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/app_access_token_internal)：应用身份 token。
- [飞书：事件订阅请求地址配置](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)：HTTP 回调地址验证和事件推送。
- [飞书 Node SDK：处理事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/server-side-sdk/nodejs-sdk/handling-events)：官方 SDK 的事件处理入口，包括长连接方式的实现语境。
- [Lark：Using long connection to receive events](https://open.larksuite.com/document/server-docs/event-subscription-guide/event-subscription-configure-/choose-a-subscription-mode/using-long-connection-to-receive-events)：长连接无需暴露公网 callback URL，由 SDK 向平台建立连接。
- [飞书开放平台服务协议](https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/terms-of-service)：平台使用和开发者责任。
- [飞书隐私政策](https://www.feishu.cn/privacy)：个人信息处理和数据保护的总框架。

说明：`accounts.feishu.cn/oauth/v1/app/registration` 的 `init/begin/poll` 协议由 OpenClaw 官方源码直接展示，但在本次检索到的飞书公开 API 文档中没有对应的稳定公共参考页。因此下文不会把它宣称为面向所有开发者、长期兼容的标准 OAuth API；它更像飞书“一键创建应用/CLI onboarding”能力。

## 2. 二维码内容与扫码方

### 二维码内容

`beginAppRegistration()` 向以下地址提交表单：

```text
POST https://accounts.feishu.cn/oauth/v1/app/registration
POST https://accounts.larksuite.com/oauth/v1/app/registration
Content-Type: application/x-www-form-urlencoded
```

先以 `action=init` 检查服务端是否支持 `client_secret`；再以如下参数开始：

```text
action=begin
archetype=PersonalAgent
auth_method=client_secret
request_user_info=open_id
```

飞书返回 `device_code`、`user_code`、`verification_uri`、`verification_uri_complete`、`interval`、`expire_in`。OpenClaw 对 `verification_uri_complete` 仅追加两个查询参数：

```text
from=oc_onboard
tp=ob_cli_app
```

随后把这个完整 URL 交给终端 QR renderer。也就是说：

- QR 是一个飞书/Lark Accounts HTTPS URL。
- `device_code` 通常作为该短期 URL 的会话关联信息存在，但应以服务端实际返回的 URL 为准，不能假定固定明文格式。
- QR 中不含 App Secret、tenant token、user token，也不含 OpenClaw 云地址。
- 本地同时保存 `device_code` 用于轮询；二维码只是让手机进入同一授权/建应用会话。

源码依据：[注册返回类型与 URL 构造](https://github.com/openclaw/openclaw/blob/1089253ca97c86bc8ef5df139c1c672d27ce59f4/extensions/feishu/src/app-registration.ts#L39-L158)，[QR 测试和修复](https://github.com/openclaw/openclaw/commit/1089253ca97c86bc8ef5df139c1c672d27ce59f4)。

### 谁扫码、扫码做什么

源码注释明确要求“scan with Feishu/Lark mobile app”，所以扫码方是**希望创建并绑定该应用的飞书/Lark 登录用户**，不是机器人，也不是 OpenClaw 服务。`request_user_info=open_id` 要求成功结果带回该用户 `open_id`；向导把它设为 `dmPolicy=allowlist` 的唯一初始成员。因此扫码者既是应用创建/授权操作者，也是默认被允许私聊机器人的用户。

这是一项高权限动作：用户不是仅仅“登录本地插件”，而是在自己的飞书/Lark 环境中确认创建应用并把应用凭证交给本地程序。二维码页面展示的应用名称、权限、租户和确认文案必须由用户核对。

## 3. 是否仍需要 App ID/Secret

**需要，而且是运行必需。** 两种设置方式最终汇合到同一配置：

- manual：用户从飞书开放平台复制 App ID 和 App Secret。
- scan：轮询成功后飞书返回 `client_id` 和 `client_secret`，OpenClaw 分别保存为 `appId` 和 `appSecret`。

向导随后写入：

```text
channels.feishu.appId     = client_id
channels.feishu.appSecret = client_secret
channels.feishu.connectionMode = websocket
channels.feishu.domain = feishu | lark
```

运行时官方 SDK 使用这对凭证获取平台侧应用/租户授权并创建 WS 连接、调用消息 API。二维码只自动化了“创建应用 + 获取凭证”，没有设计出一种免 Secret 的机器人协议。

Secret 不应进入二维码、浏览器前端、日志或 Git。OpenClaw 文档要求泄漏后在开放平台重置 Secret、更新配置并重启 gateway；源码还会清洗 WebSocket 错误日志中的 Bearer/token/secret/password 字段。

## 4. 是否依赖 OpenClaw 云端或中继

在所审源码中，答案是：**不依赖 OpenClaw 自有云/中继。** 网络参与方只有：

```text
本地 OpenClaw CLI/Gateway
  ├─ HTTPS -> accounts.feishu.cn / accounts.larksuite.com（扫码建应用）
  ├─ HTTPS -> open.feishu.cn / open.larksuite.com（token 和 OpenAPI）
  └─ WebSocket -> 飞书/Lark 官方长连接服务（接收事件）
```

WebSocket 模式是本地进程主动向飞书建立出站连接，无需公网入站地址。Webhook 模式则由本地/自托管服务器开放事件 URL 给飞书访问；若机器位于 NAT 后，部署者可能自行增加反向代理或隧道，但这不是 OpenClaw 必需的官方中继。

需要准确区分“不依赖 OpenClaw 云”与“完全离线”：它绝不可能离线运行，仍强依赖飞书云账号、应用管理、OpenAPI、消息和事件基础设施。扫码注册端点也属于飞书 Accounts 云服务。

## 5. token、回调与长连接完整流程

### A. 扫码建应用阶段

1. 本地 CLI 调 `action=init`，确认 Accounts 环境支持 `client_secret`。
2. 调 `action=begin`，指定 `PersonalAgent/client_secret/open_id`。
3. 服务端返回 `device_code`、短期 QR URL、轮询间隔和过期时间；OpenClaw 默认保护值是每 5 秒、最多 600 秒。
4. CLI 打印 `verification_uri_complete` 的 QR；飞书/Lark 手机用户扫码并在飞书页面确认。
5. 本地 CLI 按服务端 `interval` 向同一 `/oauth/v1/app/registration` POST：

```text
action=poll
device_code=<本地保存的值>
tp=ob_cli_app
```

6. `authorization_pending` 继续等；`slow_down` 将间隔增加 5 秒；`access_denied`、`expired_token` 或超时终止。若返回 `tenant_brand=lark`，代码切到 Lark Accounts 域名后重试。
7. 成功响应含 `client_id/client_secret/user_info.open_id`。它们不是 OAuth `user_access_token`。
8. 本地保存应用凭证，并将扫码者 `open_id` 写入 DM allowlist；组策略仍由用户选择。

### B. 应用/租户 token 与 API 调用阶段

OpenClaw 在 `getAppOwnerOpenId()` 中给出了明确例子：

```text
POST /open-apis/auth/v3/tenant_access_token/internal
{ "app_id": "...", "app_secret": "..." }
  -> tenant_access_token

GET /open-apis/application/v6/applications/{appId}?user_id_type=open_id
Authorization: Bearer <tenant_access_token>
  -> owner/creator open_id
```

官方文档把 token 身份分开：

- `app_access_token`：应用身份；自建应用由 App ID/Secret 获取。
- `tenant_access_token`：应用安装于某租户后的租户级身份；机器人消息与多数租户资源 API 使用它。
- `user_access_token`：用户明确授权后的用户身份；标准 OAuth authorization code 流程换取，并可配 refresh token。

它们**不是固定的三级流水线**。扫码建应用得到的是应用凭证和 `open_id`；OpenClaw Feishu bot 通道的核心消息收发通常由 SDK 基于 App ID/Secret 管理应用/租户 token，不需要先做用户 OAuth。只有要“以用户身份”访问用户资源时，才另做标准 OAuth，必须有授权 URL、严格匹配的 `redirect_uri`、`state`，服务端用 code 换 `user_access_token` 并安全刷新/撤销。

### C. OAuth 回调、事件回调和 WebSocket 不能混为一谈

- **扫码注册轮询**：无 OpenClaw HTTP callback；本地主动 poll Accounts。
- **标准用户 OAuth callback**：浏览器在用户同意后回到预注册 `redirect_uri`，携带短期 code/state；这是取得 user token 的通道。
- **事件 HTTP callback**：飞书将消息事件 POST 到应用配置的公网 URL；需要 challenge 验证、验签/解密、防重放和快速响应。
- **事件 WebSocket**：本地 SDK 持 App ID/Secret 主动连接飞书，平台在连接上推送订阅事件；不要求公网回调 URL。

### D. OpenClaw 默认长连接

设置完成后 `connectionMode=websocket`。Gateway 启动时创建 `@larksuiteoapi/node-sdk` 的 `WSClient`，加载 `EventDispatcher`，接收诸如 `im.message.receive_v1` 的事件，再路由到本地 agent；回复时通过飞书 OpenAPI 发消息。连接失败会从 1 秒开始指数退避，最大 30 秒并重建 client。

官方 OpenClaw 文档要求应用已发布/审批、订阅 `im.message.receive_v1`、选择 persistent connection 并授予所需 scope。扫码创建并不代表租户管理员审批、发布和权限配置永远可跳过；最终以飞书控制台状态和组织策略为准。

Webhook 是可选模式。固定版本源码不仅要求 `encryptKey`，配置参考还把 `verificationToken` 和 `encryptKey` 都列为 webhook 必需项；实现对 `X-Lark-Request-Timestamp + nonce + encryptKey + rawBody` 做 SHA-256 常量时间比较，在解析 JSON 前拒绝无效签名，并限制 Content-Type、请求体大小、读取时间和速率。生产部署还应加 HTTPS、可信反向代理配置、重放时间窗、事件去重和最小暴露面。

## 6. DeepSeek Harness 本地插件能否等价复现

**技术上可以复现主要用户体验与协议，但应分成两个层级。**

### 推荐、稳定的等价实现

在 DSH 插件中实现标准的“手工创建应用 + App ID/Secret + 飞书官方 SDK WebSocket”：

1. 插件设置页/向导收集 Feishu/Lark 域、App ID、App Secret。
2. Secret 只送到 DSH 后端，使用 Harness 的 Secret 存储/引用能力；前端永不回显完整 Secret。
3. 后端用官方 `@larksuiteoapi/node-sdk` 建立 WSClient 和 EventDispatcher。
4. 为每个租户/应用维护独立 client、token cache、事件去重和 reconnect 状态。
5. 将 `open_id/chat_id/message_id` 映射到 DSH 会话，执行 allowlist、群组 @mention 和 agent 路由。
6. 回复通过官方消息 API，停用/卸载时关闭 WS、撤销或删除本地凭证和映射。

该方案与 OpenClaw **运行阶段等价**，完全不需要 DSH 云中继，且只依赖飞书公开支持的 SDK/API。

### 复刻“扫码即创建应用”

也可按 OpenClaw 源码实现：后端调用 Accounts `init/begin`，把 `verification_uri_complete` 生成 QR，通过后端按 `device_code` 轮询，并在成功后保存 `client_id/client_secret/open_id`。实现约束：

- 必须由 DSH 后端调用；不要在 Web 前端直接访问 Accounts 或持有 `device_code/client_secret`。
- QR 页面只显示飞书返回的 URL，设置短期过期、一次性 session、取消按钮和明确的域/租户提示。
- 后端应限制 Accounts host allowlist，防 SSRF；OpenClaw 自身使用 `fetchWithSsrFGuard` 且只允许目标 hostname。
- 对 `authorization_pending/slow_down/denied/expired/timeout` 完整建模，支持取消和清理。
- 成功后立即加密保存 Secret，页面只显示 App ID 和绑定主体；禁止通过插件日志、agent prompt、tool result 回传 Secret。
- Feishu 与 Lark 使用不同 Accounts/OpenAPI 域和数据边界，不能只替换一个 host 就假定账号互通。

最大风险是：这个 `/oauth/v1/app/registration` 协议虽见于 OpenClaw 官方源码，却缺少本次可确认的飞书稳定公共 API 契约。等价复刻前应取得飞书对该能力、`PersonalAgent` archetype 和 `ob_cli_app` 参数用于第三方产品的书面许可/文档；否则可能随时变更、被限流，或违反平台用途约束。生产插件应把 scan-to-create 做成可降级功能，始终保留手工 App ID/Secret 路径。

## 7. 安全与合规限制

### 凭证和 token

- App Secret、app/tenant/user access token、refresh token 都是服务端秘密；不得置于 QR、前端 bundle、URL 查询参数、日志、错误遥测、Git 或 agent 上下文。
- 使用系统 keyring/KMS/加密 secret store；配置文件只保存 SecretRef。限制文件权限、备份范围和运维读取权限。
- token 按官方 `expire` 缓存并提前刷新，避免每次请求重复获取；按 app + tenant + identity 隔离 cache，避免跨租户串用。
- Secret 泄漏立即在飞书控制台轮换；用户撤销授权或卸载应用时删除 token、refresh token、身份映射和不再需要的数据。

### 授权与身份绑定

- QR session 必须高熵、短期、一次性，并绑定本次 DSH 浏览器会话；防止截屏转发后把错误账号/租户绑定到当前插件。
- UI 在扫码前后显示目标 Feishu/Lark 域、应用动作、权限范围和最终绑定的用户/租户；对主体不一致要求二次确认。
- 标准 OAuth 必须验证 `state`，使用精确 allowlist 的 redirect URI；支持时采用 PKCE。code 只能服务端交换且只能使用一次。
- `open_id` 是应用维度标识，不能跨应用直接当全局用户 ID；多应用、多租户映射必须包含 app/tenant 作用域。

### 事件与消息

- 最小权限：只申请实际处理消息/资源所需 scope；新增文档、日历、通讯录权限应单独说明用途并重新取得授权/管理员审批。
- Webhook 必须 HTTPS、验签/解密、验证 timestamp/nonce、限体积/速率、事件去重、快速 ACK；不要仅依赖 verification token 字段。
- WebSocket 免公网回调但不免鉴权、事件去重、访问控制和审计。SDK 自动重连时要避免重复处理同一 `event_id/message_id`。
- 默认私聊 allowlist、群聊 allowlist + 必须 @mention 是更稳妥的初始策略；公开 DM 或公开群会显著扩大 prompt injection、数据泄漏和费用滥用面。
- 用户发来的附件和富文本是不可信输入；限制大小/MIME，隔离解析，避免把飞书消息直接提升为 DSH 系统指令或高权限 tool 输入。

### 数据与平台合规

- 扫码者的同意不一定替代租户管理员审批。应用发布、机器人可用范围、敏感权限和跨组织使用须遵守租户策略和飞书开放平台审核。
- 明示收集目的、数据种类、保存期限、第三方模型处理和删除方式；遵循目的限制、数据最小化和用户撤回机制。
- Feishu 与 Lark 的账号体系、域名、租户和数据驻留边界不同。国内外部署需分别评估个人信息保护、跨境传输、企业数据政策和模型供应商的数据流。
- DSH agent 可能访问本地工作区和工具。OpenClaw 文档也明确其 per-user workspace 只是消息上下文隔离，不是恶意多租户安全边界；DSH 若面向互不信任用户，应使用进程/容器、文件系统、网络和凭证级隔离。
- 不应把未公开的 Accounts 注册端点包装成“飞书官方通用 OAuth”对外承诺；应向飞书确认授权用途、稳定性、品牌表述和再分发权。

## 最终判断

1. **准确仓库**：`https://github.com/openclaw/openclaw`。
2. **二维码/扫码方**：二维码是飞书 Accounts 返回的短期 `verification_uri_complete`；由已登录的飞书/Lark 手机用户扫码，确认创建并绑定 PersonalAgent 应用。
3. **App ID/Secret**：仍然需要；扫码成功后由飞书返回并由 OpenClaw 保存，运行时继续使用。
4. **云/中继**：无 OpenClaw 自有中继依赖；依赖飞书/Lark Accounts、OpenAPI 和 WebSocket 云服务。
5. **完整流程**：Accounts `init -> begin -> QR -> poll` 得应用凭证；SDK再以应用凭证管理平台 token；事件默认走出站 WebSocket，HTTP webhook 可选；标准 user OAuth callback 是独立流程。
6. **DSH 复现**：手工凭证 + 官方 SDK WS 可稳定等价复现；扫码建应用也可技术复刻，但因 Accounts 注册协议缺少稳定公开契约，生产使用前需要飞书确认并保留手工降级。
7. **安全合规**：Secret/token 仅后端加密存储，短期一次性 QR、主体/租户确认、最小权限、事件验签与去重、严格 allowlist、多租户隔离、删除/撤销机制，以及 Feishu/Lark 数据边界与平台条款审查，均不可省略。
