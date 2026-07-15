# 86 Tauri Chat Skill Fixes

## 用户需求

- 在当前修复分支上先处理现有 bug，再实现 IDE 模式下的 Agent Chat 性能优化与 `$` skill 选择体验修复。
- 为项目补 Tauri 打包入口，并验证 Windows 本地打包链路。
- 说明 fork 仓库后如何把原作者的更新合并回当前分支。

## 实现结果

- 新建分支 `codex/tauri-chat-skill-fixes`。
- 修复当前类型检查与 agent 测试中暴露的问题：
  - Plot 面板内部 `chapterPath` 与 API DTO `chapterId` 边界不一致。
  - Gemini 工具 schema sanitizer 测试与类型收窄问题。
  - Agent profile / file-tools 测试污染真实 workspace 或依赖旧文本的问题。
  - harness 黑盒测试默认 5s 超时过紧的问题。
- Agent Chat 右侧消息流只加载并渲染最近 100 条消息，历史 session 数据仍保留，只降低 DOM 渲染压力。
- `$` / `￥` structured reference / skill 菜单支持 active item 自动滚动到可视区域，并支持空格分隔的多关键字匹配；`￥1` 会按 `1` 过滤 skill 名称、key、描述、来源路径等字段。
- Skill 触发继续补齐：`￥` 与半角 `¥` 都可调出 skill 菜单；`$10-novel`、`￥10-novel`、`¥10-novel` 这类数字开头查询可触发；`$novel` 会用子串匹配命中 `10-novel` 这种非 `novel` 开头的 skill。
- 加入 Tauri v2 scaffold、`tauri:dev` / `tauri:build` 脚本和基础应用图标；Windows MSI / NSIS 安装包已能生成。
- Tauri 桌面版启动内置 Bun/Nitro 服务，运行目录放在 exe 同目录 `data/product`，并隐藏 Bun 控制台窗口。
- 登录页改为通过本地 product workspace 保存用户名和密码，避免 Tauri 每次随机端口导致 `localStorage` 失效。
- 修复同版本重复打包后 exe 仍运行旧 `.output` 的问题：Tauri 现在比较完整 `product-build-id` marker，marker 变化时刷新 runtime，同时保留 `workspace` 与 `logs`。
- 修复 IDE 文件详情下方 `Manuscript` 统计口径：Total 只统计真实 content `index.md` 文件正文字符数，Size / Files 只统计真实文件，Chapters 只统计 `entryType === "chapter"`，避免目录节点与 `index.md` 重复计算。
- 修复 Tauri 桌面版点击右上角关闭需要等待的问题：关闭事件只取走 Nitro 子进程句柄并非阻塞触发进程树结束，不再等待 `taskkill` 完成后才关闭窗口。
- 修复右侧 Agent Chat 点击“关联 Agent”后聊天区需要额外交互才重绘的问题：关联 Agent 面板不再 Teleport 到 `body`，改为挂在 Agent 面板内部的 absolute 浮层，并在打开时主动刷新关系与聊天区布局。
- 修复 assistant 每次消息更新时右侧聊天区闪烁的问题：撤销 `AgentChatFlow` 的动态 `key` 强制重挂载，snapshot / active / session 刷新只做非破坏性滚动和焦点同步，不再销毁整块聊天流。

## 验证结果

- `bun run typecheck` 通过。
- `bun test app/components/novel-ide/agent/useStructuredReferenceMenu.test.ts` 通过。
- `bun run test:agent` 通过：55 个测试文件通过，1 个 skipped；666 个测试通过，3 个 skipped。
- `cargo check` 通过。
- `bun run tauri:build` 通过，输出：
  - `src-tauri/target/release/bundle/nsis/NeuroBook_0.5.6_x64-setup.exe`
- `bunx vitest run server/agent/http.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts` 通过：4 个测试文件、45 个测试通过。
- `bunx vitest run shared/reference-trigger.test.ts app/components/novel-ide/agent/useStructuredReferenceMenu.test.ts app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts` 通过：3 个测试文件、16 个测试通过。
- `bunx vitest run shared/reference-trigger.test.ts app/components/novel-ide/agent/useStructuredReferenceMenu.test.ts app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts` 通过：3 个测试文件、16 个测试通过，覆盖 `￥` / `¥` trigger 与 `$novel` 子串匹配 `10-novel`。
- `bunx vitest run app/utils/manuscript-stats.test.ts` 通过：1 个测试文件、2 个测试通过。
- `bun run typecheck` 通过，覆盖本轮 Manuscript 统计抽取后的前端类型。
- `bunx vitest run app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts` 通过：3 个测试文件、34 个测试通过。
- `bunx vitest run app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/components/novel-ide/agent/useAgentSessionApi.test.ts app/components/novel-ide/agent/useStructuredReferenceMenu.test.ts app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts shared/reference-trigger.test.ts` 通过：6 个测试文件、50 个测试通过。
- `bun run typecheck` 通过，覆盖本轮撤销聊天流强制重挂载后的前端类型。
- 实测启动 `src-tauri/target/release/neuro-book-tauri.exe`：修复前运行目录仍是旧 Nitro，`/api/auth/remembered-login` 返回 401；修复 runtime marker 后，运行目录刷新，新 Nitro 白名单包含 `/api/auth/remembered-login`。
- 实测 remembered-login：端口 `11401` 写入测试凭据后，重启 exe 到随机端口 `13980`，登录页仍自动填入用户名和密码；测试结束已恢复原始空凭据并关闭测试进程。

## 重要限制

当前 Windows 桌面版已经接入内置 Bun/Nitro 本地服务，不再是纯静态 WebView 外壳。仍需继续观察长会话右侧 Agent 面板在真实账号数据下的交互性能，尤其是关联 Agent 后的状态刷新与长消息渲染。
