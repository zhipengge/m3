# m3 改进评估与路线图

本文基于当前代码库评估，记录**已落地**与**建议后续**的改进点。

## 已落地（本轮）

| 领域 | 改进 |
|------|------|
| 安装体验 | `install.sh`、`m3 install`、zsh/bash 补全、`m3` 全局命令 |
| 终端 | `m3 chat` / `gateway -i`，slash 命令扩展（`/config`、`/resume` 等） |
| 飞书 | 收到 **OK** 表情、处理完成 **THUMBSUP**；需开放平台表情权限 |
| 权限 | 通道默认 `channelPermissionMode: default`（v0.2 起；旧默认 `bypassPermissions` 改为显式开启） |
| 控制台 | `/dashboard`：CPU/内存、通道、会话、**配对列表**、**事件日志** |
| 可靠性 | 管道错误回传用户；**同 session 串行锁**避免并发跑 Agent |
| 配对 | `dmPolicy: pairing` 时持久化 `~/.m3/pairing.json`，`/pair CODE` 放行 |
| 会话 | `/clear` 清除 session 映射与 transcript |
| 运维 | `m3 status`、`~/.m3/gateway.pid`、`/health` 含通道/会话计数 |
| 通道 | `m3 channels remove`、`channels scan` 多通道入口（微信占位） |

## 建议优先级（下一步）

### P0 — 体验与稳定

1. **飞书长消息分片**：超长回复按 4k 字符切块发送，避免 API 失败。
2. **入站去重**：同一 `message_id` 只处理一次（飞书可能重投）。
3. **Gateway 配置热加载**：修改 `m3.json` 后 `SIGHUP` 或 dashboard 按钮重载通道。
4. **WS 协议补全**：实现 `connect` / `send` / `agent.wait`，供 IDE/远程客户端对接。

### P1 — 对标 OpenClaw / Claude Code

5. **控制台可操作**：Dashboard 启停通道、删除会话、查看 transcript 摘要。
6. **微信通道**：企业微信或公众号 OAuth + 扫码绑定（替代占位页）。
7. **TUI 模式**：`m3 tui` 全屏终端（替代 readline REPL）。
8. **CC 命令对齐表**：维护 `docs/CC-COMMANDS.md`，逐项标记支持/部分/未实现。
9. **子 Agent 可视化**：dashboard 展示 sub-agent 树与状态。

### P2 — 性能与安全（Mac 优先）

10. **MCP 连接池懒加载**：首条消息再连 MCP，缩短 gateway 冷启动。
11. **Transcript 压缩**：`/compact` 真正摘要写入 transcript，而非仅 inject prompt。
12. **配对码过期**：24h 未 `/pair` 自动失效。
13. **gateway.authToken 默认提示**：非 loopback bind 时 doctor 强制警告。
14. **Apple Silicon 优化**：可选 `NODE_OPTIONS=--max-old-space-size` 文档与 install 预设。

### P3 — 生态

15. Discord / Telegram 首个 Phase3 通道（择一实装）。
16. **插件市场路径**：`plugins.paths` 文档 + 示例仓库结构。
17. **Hook 执行器**：`hooks` 配置真正触发 onInbound/onReply。
18. **Voice / IDE 插件**：沿用 `phase4-advanced` 接口渐进实现。

## 使用新能力

```bash
# 配对模式（examples 默认 webchat 为 pairing）
# 飞书用户首次私信会收到：/pair XXXXXX

m3 status
m3 chat
open http://127.0.0.1:18790/dashboard

m3 channels remove --channel feishu --account default
```

## 评估结论

m3 已完成 **MVP + 通道扫码 + 控制台 + 终端 REPL** 闭环；与 OpenClaw 的差距主要在 **通道数量、控制台交互深度、WS 控制面完整度**；与 Claude Code 的差距在 **TUI、全量 slash、IDE 集成**。建议按 P0→P1 迭代，避免过早铺 20+ 通道 stub。
