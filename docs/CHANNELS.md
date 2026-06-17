# 通道联调指南（飞书 / Slack）

本文说明如何在本地把 m3 Gateway 与 **飞书**、**Slack** 真实连通，并验证 **多模态附件落盘**。

## 终端交互（类似 Claude Code）

```bash
m3 chat          # 推荐：启动 Gateway + 终端 REPL
m3               # 同上（无子命令时默认进入交互）
m3 gateway -i    # 等价
```

出现 `you>` 提示符后输入自然语言或 `/help`。飞书消息与终端会话并行（Gateway 同时跑通道）。

## Tab 自动补全（macOS zsh）

```bash
./install.sh --with-completion   # 或已安装后：m3 completion install && exec zsh
```

若用 `pnpm m3` 而非全局 `m3`，补全不会生效，请用 `./install.sh` 安装到 `~/.local/bin`。

## 前置条件

```bash
./install.sh
$EDITOR ~/.m3/secrets.json   # 填入 DeepSeek 等 API Key
```

开发者在仓库内也可用 `pnpm install && pnpm build`。

## DM 配对（dmPolicy: pairing）

默认 `webchat` 为 `pairing`。未在 `allowFrom` 中的用户会收到：

```
未配对。请发送：/pair ABCD12
```

发送正确配对码后写入 `~/.m3/pairing.json`。扫码配置飞书时默认 `dmPolicy: open`（免配对）；若改回 `pairing`，同样支持 `/pair`。

Dashboard → **Pairing** 面板可查看待配对列表。

## 扫码配置飞书（推荐，最简单）

无需 Verification Token、无需 ngrok。默认使用飞书官方 **长连接** 接收事件。

```bash
cd /path/to/m3
m3 channels scan
```

1. 终端会出现 **二维码**（同一 WiFi 下用手机扫）
2. 手机打开页面，只填 **App ID**、**App Secret**（从飞书开放平台复制）
3. 提交后写入 `~/.m3/m3.json`
4. 本机运行 `pnpm m3 gateway`
5. 飞书开放平台 → **事件与回调** → 订阅方式选 **「使用长连接接收事件」** → 添加 `im.message.receive_v1`
6. 权限：开启 **发送、删除消息表情回复**（`im:message.reactions:write_only`）或 `im:message`，否则「收到」OK 表情不会显示

> 长连接要求：先让 `m3 gateway` 跑起来并保持连接，再在后台保存「长连接」订阅方式。

## 交互式配置（终端问答）

```bash
pnpm m3 channels configure
pnpm m3 channels list
```

Slack / WebChat 仍用向导；飞书也可选 `webhook` 模式（需公网 URL）。

启动 Gateway（可先 mock 验证管道）：

```bash
node packages/cli/dist/cli.js gateway --mock
# 或真实 Agent
node packages/cli/dist/cli.js gateway
```

`m3 doctor` 可快速检查配置、模型、MCP、通道账号状态。

## 大量出现 `Permission denied`？

飞书/Slack 等通道**没有终端**，无法响应运行时审批弹窗。从 v0.2+ 起，通道默认 `channelPermissionMode: "default"`，会拦截 Bash / 工作区外写入等高危工具，避免远程用户随意触发命令。

调优思路（择一或组合）：

1. **白名单常用工具**（推荐）：在 `agent.permissions.allow` 列出明确允许的工具，如 `["Read", "Grep", "Glob", "Edit", "Write"]`，让通道用户能正常读写而 Bash 仍需手动审批：
   ```json
   "agent": {
     "permissions": { "allow": ["Read", "Grep", "Glob", "Edit", "Write"] }
   }
   ```
2. **acceptEdits**：信任的通道可设 `"channelPermissionMode": "acceptEdits"`，文件改动自动放行、Bash 仍受限。
3. **完全放行**（仅限可信账号 + `allowFrom` 白名单 + 一次性脚本场景）：
   ```json
   "agent": { "channelPermissionMode": "bypassPermissions" }
   ```
   ⚠️ 一旦开启，凡能给 Bot 发消息的人都可在工作区跑任意 Bash。务必同时收紧 `dmPolicy: "pairing"` 与 `allowFrom`。

修改后**重新构建并重启**（旧进程不会加载新逻辑）：

```bash
pnpm build
m3 gateway
```

若仍出现拒绝：看终端里 `[m3:audit] permission denied tool=...` 是哪类工具；按需追加到 `permissions.allow`。

本地 CLI 仍可用 `permissionMode: "default"`；仅飞书/Slack/WebChat 走 `channelPermissionMode`。

---

## 飞书（Feishu / Lark）

### 1. 开放平台配置

1. 创建企业自建应用，记录 **App ID**、**App Secret**。
2. 权限：至少开通 IM 相关（接收消息、发送消息、获取资源）。
3. **事件订阅** → 选择「将事件发送至开发者服务器」：
   - URL：`http://<公网或内网穿透地址>:18791/feishu/events`
   - 本地默认：`http://127.0.0.1:18791/feishu/events`（需 ngrok/frp 暴露）
4. 订阅事件：`im.message.receive_v1`。
5. 填写 **Verification Token**（与 `m3.json` 中 `verificationToken` 一致）。

### 2. m3 配置

```json5
// ~/.m3/m3.json
channels: {
  feishu: {
    default: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",
      webhookPath: "/feishu/events",
      webhookPort: 18791,
      verificationToken: "your-token",
      dmPolicy: "open",        // 联调可先用 open；生产建议 pairing
      allowFrom: []
    }
  }
}
```

### 3. 启动与验证

```bash
m3 gateway
# 日志应出现：feishu default: webhook listening http://127.0.0.1:18791/feishu/events
```

1. 在飞书开放平台点击「保存」事件订阅，应通过 URL 校验（challenge）。
2. 向机器人发文本消息 → Gateway 应触发 Agent 回复。
3. 发送图片 → 文件落盘至 `~/.m3/media/feishu/default/`，prompt 含 `[Attachments]` 路径。

### 4. 常见问题

| 现象 | 处理 |
|------|------|
| URL 校验失败 | 检查 `verificationToken`、端口是否被占用、穿透是否指向 18791 |
| 收不到消息 | 确认应用已发布、用户/群已添加机器人、事件已订阅 |
| 图片下载失败 | 检查 IM 资源权限；查看 Gateway 日志 `feishu image download failed` |

---

## Slack（Socket Mode）

### 1. Slack App 配置

1. [api.slack.com](https://api.slack.com/apps) 创建 App。
2. **OAuth & Permissions** → Bot Token Scopes：`app_mentions:read`, `chat:write`, `files:read`, `im:history`, `channels:history`（按场景增减）。
3. 安装到 Workspace，复制 **Bot User OAuth Token**（`xoxb-`）。
4. **Basic Information** → **App-Level Tokens** → 创建带 `connections:write` 的 token（`xapp-`）。
5. **Socket Mode** → 启用。

### 2. m3 配置

```json5
channels: {
  slack: {
    default: {
      enabled: true,
      botToken: "xoxb-...",
      appToken: "xapp-...",
      dmPolicy: "open",
      allowFrom: []
    }
  }
}
```

> `isConfigured` 要求 **同时** 配置 `botToken` 与 `appToken`。

### 3. 启动与验证

```bash
m3 gateway
# 日志：slack default: Socket Mode connected
```

1. 在频道或 DM 中 @ 机器人或直接发消息。
2. 上传文件/图片 → 落盘 `~/.m3/media/slack/default/`，Agent prompt 附带路径。

### 4. 常见问题

| 现象 | 处理 |
|------|------|
| `requires botToken + appToken` | 补全 Socket Mode 的 app-level token |
| 发消息无回复 | 检查 `dmPolicy` / `allowFrom`；确认 Gateway 未 mock 且模型 Key 有效 |
| 附件未落盘 | 确认 `files:read` scope；文件需带 `url_private` |

---

## 多模态与 Agent

入站消息经 `MessagePipeline` 转为 prompt 时，附件会追加：

```
[Attachments — use Read tool on these paths if needed]
- [image] ~/.m3/media/feishu/default/xxx.png (image/png)
```

Agent 在沙箱内可用 `Read` 读取这些路径（路径在 workspace 外时会被沙箱拒绝——联调时可将 `agent.cwd` 设为 `~` 或关闭 `sandbox.allowReadOutside` 仅用于读附件，生产请复制到 workspace）。

---

## 本地无公网时联调飞书

1. `ngrok http 18791` 或 `cloudflared tunnel` 暴露 webhook 端口。
2. 将公网 URL + `/feishu/events` 填入飞书事件订阅。
3. 保持本机 `m3 gateway` 运行。

---

## WebChat 快速冒烟（无需外网）

```bash
M3_MOCK_AGENT=1 node packages/cli/dist/cli.js webchat --mock
```

输入任意文本，验证 Bridge → Agent → 回包链路。
