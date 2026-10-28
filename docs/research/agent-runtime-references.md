# Agent 运行时的外部参照：omp、DeepSeek Harness 与模型接口的工具发现

- 日期：2026-10-28
- 问题：NeuroBook 接入 Agent（[w00032](../../.agents/works/w00032-agent-integration/README.md)）时，内部 URI、内置工具、会话树与斜杠命令、子代理、审批、Skill、MCP 与工具发现，在 omp 与 DeepSeek Harness 里各是怎样做的；主流模型接口与 OMP 包族对工具发现支持到哪一步。
- 版本：omp（`@oh-my-pi/pi-coding-agent`）18.12.3，本机全局安装、包内带 TypeScript 源码；仓库锁定的 OMP 包族（`pi-agent-core`、`pi-ai`、`pi-catalog` 等）18.2.5；DeepSeek Harness 为 `../deepseek-harness` 的 `21638c5631`（2026-09-27）。
- 证据等级：**源码（核实）** 为本会话读过源码原文；**源码（走查）** 为子代理静态阅读、本会话未逐行复核；**官方文档**；**检索**为搜索结果摘要，未读原文。
- 状态：资料，不是设计依据。被采用的部分写进 w00032 各 Task 的计划与 Spec。

## 1. omp 的内部 URI

源码（走查）：注册入口 `src/internal-urls/router.ts`，各方案的读写规则在各自的 `*-protocol.ts`，给模型的说明在 `src/prompts/internal-urls/*.md`。

| 方案 | 指向 | 读写 |
|---|---|---|
| `skill://` | 已加载 Skill 的 `SKILL.md`，`skill://<名>/<路径>` 读其下文件 | 只读 |
| `rule://` | 规则库里的规则 | 只读 |
| `memory://` | 按项目的记忆摘要（仅本地记忆后端时出现） | 只读 |
| `agent://` | 子代理的输出，嵌套 id 用点号；写入等于给子代理发消息 | 读；写为消息 |
| `history://` | 会话记录渲染成 Markdown | 只读 |
| `artifact://` | 溢出的大输出，可按行分页 | 只读 |
| `local://` | 会话级暂存区，根在会话的 artifacts 目录下的 `local/` | 读写 |
| `proc://` | 后台任务与服务：状态、输出、写 stdin、结束 | 写为执行档 |
| `cfg://` | omp 设置，写入要用户批准 | 写档 |
| `omp://` | omp 自带的文档；提示词写着没被问到就别读 | 只读 |
| `mcp://` | MCP 资源 | 只读 |
| 其它 | `ssh://`、`vault://`、`issue://`、`pr://`、`security://`、`attachment://`、`conflict://`、`xd://` | 各异 |

- 没有 `docs://`、`session://`、`plan://`（源码与提示词中零命中）。计划文件经 `local://` 列出；会话记录用 `history://`。
- 每个方案按会话条件决定是否发布给模型（例如 `issue://` 只在 PATH 上有 `gh` 时出现）；`bash` 与 `find` 也把这些地址当路径用。

目录（源码走查）：agent 目录 `~/.omp/agent`（环境变量可改），项目目录 `<cwd>/.omp`，命名配置 `~/.omp/profiles/<名>/agent`；会话在 `~/.omp/agent/sessions/<按 cwd 编码>/<时间>_<uuid>.jsonl`，同名目录是这个会话的 artifacts 目录。用户级与项目级配置同时读 `.omp`、`.claude`、`.codex`、`.gemini`。

## 2. omp 的工具、会话与斜杠命令

内置工具（源码走查，`src/tools/builtin-names.ts`）：read、write、edit、bash、glob、grep、find（语义搜索）、ast_grep、ast_edit、lsp、eval、task（子代理）、ask、todo、wait、web_search、github、checkpoint、rewind、context_notes、new_context、记忆与 Skill 管理、generate_image 等。名字全是小写下划线，没有命名空间前缀；MCP 工具名为 `mcp__<服务>_<工具>`。

会话（源码走查，`src/session/session-manager.ts`）：JSONL 条目带 `id` 与 `parentId`，构成树；条目类型有 message、compaction、branch_summary、model_change、thinking_level_change、mode_change、custom、label 等。

斜杠命令（源码走查，`src/slash-commands/`）：

- `/branch`，别名 `/rewind`：回到之前的某条消息，旧路径保留为分支。
- `/fork`：复制出一个新会话，可在终端复用器的新窗格里打开。
- `/tree`：在会话树里切换分支。
- `/compact`：手动压缩上下文。
- 工具 `checkpoint`、`rewind` 是另一回事：按 git 检查点回滚工作区文件，并记下会话条目 id。

## 3. omp 的子代理、审批、Skill 与 MCP

- **子代理**（源码走查，`src/task/`）：一个 `task` 工具，支持批量、后台异步与结构化输出，结果经 `agent://` 读取。代理定义是 Markdown 加 frontmatter（name、description、spawns、model、thinkingLevel），依次从内置、`~/.omp/agent/agents/`、`.omp/agents/` 发现。
- **审批**（源码走查，`pi-agent-core` 的 `ToolTier`、`pi-coding-agent/src/tools/approval.ts`）：
  - 工具声明 read、write、exec 三档；模式有 always-ask、always-ask-cached、write、yolo，各自自动放行到某一档；
  - 可以逐个工具设置 allow、deny、prompt；
  - 没有设置时按 always-ask 处理；批准按档位与路径缓存。
  - 源码（核实）：仓库锁定的 18.2.5 `pi-agent-core` 的工具声明已有 `approval`（档位、理由、强制询问、按参数动态判定），没声明的按 exec 处理。
- **Skill**（源码走查）：`SKILL.md` 加 YAML frontmatter（name、description、globs、alwaysApply、hide、disable-model-invocation）；发现目录包括 `~/.omp/agent/skills`、`<项目>/.omp/skills`、`~/.claude/skills` 与 cwd 祖先链上的 `.claude/skills`、`~/.codex/skills`、插件包里的 `skills/`；经 `skill://` 与 `/skill:<名>` 使用。
- **MCP**（源码走查）：读项目级 `.mcp.json`、`mcp.json` 与 `.omp/mcp.json`；资源经 `mcp://` 访问。
- **扩展**（源码走查）：`~/.omp/agent/extensions/*.ts` 会被加载；包内有 `examples/`（custom-tools、extensions、hooks、sdk）。

## 4. 工具发现

### 4.1 模型接口

| 接口 | 做法 | 证据 |
|---|---|---|
| Anthropic Messages | 工具列表里放一个工具搜索工具（regex 或 BM25 两种），其余工具标 `defer_loading: true`，被搜到后才加载；搜索范围是工具名、说明、参数名与参数说明；文档建议最常用的 3 到 5 个工具不延迟 | 官方文档（[tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)），检索摘要 |
| OpenAI Responses | 工具列表里加 `tool_search`，函数工具标 `defer_loading: true`；MCP 服务可整体延迟；命名空间里可以混放延迟与不延迟的工具 | 官方文档（[Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)），检索摘要；有第三方资料说要 gpt-5.4 以后的模型，未核实 |
| Gemini | 检索结果里只有一次交全部函数声明与 `allowed_function_names`，没有找到工具搜索或延迟加载 | 检索，未读原文 |
| OpenAI Chat Completions 兼容端点（DeepSeek 与各家网关） | 没有找到 | 未核实 |

### 4.2 OMP 包族 18.2.5（仓库锁定版本，源码核实）

- `pi-agent-core` 的 `AgentTool` 有 `loadMode: "essential" | "discoverable"` 与给发现索引用的 `summary`。类型注释说：discoverable 的工具不放进每次请求，改挂在 `xd://` 设备下或经 BM25 工具搜索出现；这两种呈现都由上层应用实现，`pi-agent-core` 只有字段。
- `pi-ai` 的 `Tool.deferLoading`：只对 Anthropic 生效，发出 `defer_loading: true`。
- `pi-ai` 的 Anthropic 实现另有“会话内工具增减”（`planStableAnthropicTools`）：
  - 整个会话里顶层 `tools` 数组逐字节不变；
  - 离开的工具用 `tool_removal` 撤下，新加的工具以 `defer_loading: true` 追加到末尾，再用 `tool_addition` 提供；
  - 已有工具的定义变了就无法用控制消息表达，整份重建。
  - 这个功能要 beta 头 `mid-conversation-tool-changes-2026-07-01`，由模型兼容项 `supportsMidConversationToolChanges` 开启，`pi-catalog` 里缺省为 `false`。
- `pi-ai` 的 OpenAI Responses 部分：协议类型里有 `defer_loading`、`tool_search_call`、`tool_search_output`，回放历史时保留非服务端执行的 `tool_search_output`；发请求的代码里没有设置 `defer_loading` 的地方（grep 零命中），推断 18.2.5 不会向 OpenAI 发出延迟工具。
- `pi-ai` 能解析 Anthropic 服务端工具搜索的结果块（`tool_search_tool_regex`、`tool_search_tool_bm25`）。
- nb-harness 的工具声明（`packages/nb-harness/src/tools/registry.ts`）目前没有 `loadMode` 或 `deferLoading` 字段。

### 4.3 omp 18.12.3（命令行应用，源码核实）

- BM25 工具发现已经去掉，没有替代：设置迁移代码删掉了 `tools.discoveryMode`、`tools.essentialOverride`、`mcp.discoveryMode`、`mcp.discoveryDefaultServers`（`src/config/settings.ts`）。
- 现在的做法是 `xd://` 虚拟设备（`src/tools/xdev.ts`）：
  - discoverable 的内置工具与自定义工具从请求的 `tools` 数组里撤下；
  - 模型用已有的 `read`、`write` 操作它们：`read xd://` 列出，`read xd://<工具>` 取说明与参数 schema，`write xd://<工具>` 以 JSON 参数执行；
  - 参数校验与原生工具调用同一套，校验失败时把 schema 一起退回；
  - 全部设备的说明与 schema 也可以直接写进系统提示词，省去第一次的读取。
- 有几个工具始终留在顶层：todo、ask、grep、web_search、yield。代码注释（引 issue #5973）说，多数模型不懂 `xd://` 协议，把 web_search 藏到设备后面，实际上就调不到了。

## 5. DeepSeek Harness

源码与文档（走查），出处在 `../deepseek-harness`：

- **结构**：一切是插件，基于 Cordis；`packages/<组>/<包>` 约 60 个，另有 `apps/{cli,web,desktop,desktop-host}`。
- **home**：`$DSH_HOME`（缺省 `~/.dsh`）；共享的 agent 根是 `$DSH_AGENTS_HOME`（缺省 `~/.agents`）。Profile 是 home 下的命名组合：bundle 列表、域外插件与 `cordis.patch.yml`，按 bundle、Profile 补丁、home 补丁、命令行补丁的顺序叠加（`docs/architecture.md`）。
- **工具**：工具就是插件（`packages/**/tool-*`，经 `ctx.tools` 注册），`docs/tool-catalog.md` 由脚本逐个启动工具插件生成，漏写会失败。名字是小写下划线：
  - 文件：read、write、edit、glob、grep；
  - 终端：bash、terminal_*；
  - 子代理：subagent、subagent_fork、send_message；
  - 会话检索：session_search；
  - 目标与计划：create_goal、exit_plan_mode；
  - 其它：todo_write、skill、schedule_*、ask_user_question、plugin_manager、web_fetch、web_search 等。
- **会话**：只追加的事件日志，模型历史由日志投影；格式带版本号，相邻版本有迁移包。fork 在轮次边界经 `ctx.agents.create({seed, meta: {parentSession}})`。没有找到 rewind 或 tree 一类的用户命令；有自动压缩与 `/compact`。
- **Skill**：扫描 `SKILL.md`，name、description 缺一即忽略并告警；根目录依次是 `<项目>/.dsh/skills`、`<项目>/.agents/skills`、自定义目录、`$DSH_HOME/skills`、`~/.agents/skills`、内置。
- **钩子**：`packages/hooks` 能直接运行 Claude Code 与 Codex 的 `hooks.json` 命令钩子（会话开始、提示到达、工具执行、停止）。
- **审批**：沙箱与审批分开。审批策略是 ask（缺省）或 never；没有应答者时一律按拒绝；每次批准只管这一次；请求与结果写进会话审计。
- **子代理**：`ctx.subagents` 是接缝，并存多种提供方（进程内派生、进程内 fork、ACP、Codex、Claude Code 等）。
- **插件与 Creator 模式**：插件是 npm 包，在 `package.json` 的 `dsh` 字段声明；`plugin_manager` 工具经审批安装；`cordis_inspect_*` 只读检视运行时，持久改动以 bundle 形式安装。
- **桌面版**：Electron；`desktop-host` 在 Electron 的 Node 模式里跑与命令行共用的 Profile 运行器；关窗口是隐藏到托盘，任务继续；Python、Node、pnpm 作为运行时放在 `$DSH_HOME/dsh-runtimes/`。

## 6. Claude Code 的 Skill 目录（本机结构）

`~/.claude/skills/<名>/SKILL.md`，可附 `references/`、`scripts/`；frontmatter 都有 name 与 description，另见 metadata、disable-model-invocation、license、argument-hint、allowed-tools 等（本机 29 个 Skill 的前 12 行统计，粗略）。omp 与 DeepSeek Harness 都读同一套目录约定。

## 未验证边界

- omp 18.12.3 与仓库锁定的 18.2.5 之间，`pi-coding-agent` 以外的包是否有与本文相关的变化，没有对照。
- 两家模型接口的工具搜索没有实测；OpenAI 的模型范围来自第三方资料。
- omp 包内 `docs/*.md` 的正文（打包在 `dist/docs-index.generated.txt`，经压缩编码）没有解码阅读。
