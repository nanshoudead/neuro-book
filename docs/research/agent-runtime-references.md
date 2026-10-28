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

## 7. 上下文压缩（2026-10-28）

### 7.1 omp 18.12.3 与 OMP 包族（源码核实，本机全局安装的 `@oh-my-pi/pi-coding-agent`、`pi-agent-core`）

- **方法与顺序**：五种方法 remote（服务商原生压缩）、snapcompact（把历史画成高密度图片给有视觉能力的模型读，不调模型）、handoff（写交接文档）、soft（摘要）、shake（原地丢掉能找回的大块内容：旧图片、旧思考块、能重新读到的工具结果，不调模型）；缺省顺序 remote → snapcompact → handoff → shake → soft，不可用或失败就换下一个（`session/compaction-methods.ts`）。字节太大被拒（413）时跳过 snapcompact。shake 保护当前计划文件的读取结果。
- **触发阈值**：缺省按预留量算，触发点 = 窗口 − max(窗口的 15%, 16,384)；可以全局改为百分比或固定 token 数；另有按模型的 `compaction.modelThresholds`：给一个 token 基数（例如 1M 窗口的模型按 400K 算，85% 即 340K 触发）、一个百分比，或固定触发点（`f90000`），键可以用前缀通配（`pi-agent-core/src/compaction/compaction.ts` 的 `effectiveReserveTokens`、`resolveThresholdTokens`；`pi-coding-agent/src/config/compaction-threshold.ts`、`session/model-compaction-threshold.ts`）。缺省在运行中途、下一次请求前也检查（`compaction.midTurnEnabled`，子代理一律检查）。保留最近 20,000 token；摘要上限 16,384 token（窗口越大越容易“抄写而不是压缩”）。
- **溢出**：服务商报上下文溢出或载荷被拒时，先走压缩再自动接着跑（`session/agent-session.ts`）。
- **soft 用哪个模型**：依次取模型目录里给当前模型配的 `compactionModel`、当前会话的模型、各个角色的模型、上下文最大的模型（`session-maintenance.ts` 的 `resolveCompactionModelCandidates`）。soft 把对话**序列化成文字**、用单独的摘要系统提示词请求（`generateSummary`），所以即使是同一个模型也吃不到对话的提示词缓存。
- **吃得到缓存的是 handoff**：handoff 用会话原样的系统提示词、工具列表与消息，末尾追加一条“写交接文档”的请求，`toolChoice: "none"`，并沿用主循环的缓存路由（`generateHandoffFromContext`，注释写明是为了读到主循环已写入的提示词缓存）。
- **摘要格式**（`pi-agent-core/src/compaction/prompts/`）：soft 的固定小节为 Goal、Constraints & Preferences、Progress（Done、In Progress、Blocked）、Key Decisions、Next Steps、Critical Context、Additional Notes；再次压缩用“更新已有摘要”的提示词，要求保留旧摘要的全部信息并移动进度。handoff 的小节类似（Progress 多 Pending），要求用祈使句写给“另一个自己”。压缩后摘要以“先前的工作与工具状态可用，在其上继续、不要重做”的上下文消息放回。摘要后附 `<files>`：从工具调用算出的“读过”“改过”的文件列表（只列路径，不重新读；带 `scheme://` 的地址与网址不进列表）。另有 `compaction-turn-prefix.md`：一轮本身太大时只摘要这一轮的前半段。

### 7.2 Claude Code 2.1.312（本机二进制里的字符串，核实）

- **就地压缩**：压缩请求追加在当前对话末尾（“Your reply replaces everything above”“Tool calls will be rejected”），用的是会话的模型与原样上下文。
- **摘要格式**：九节——Primary Request and Intent、Key Technical Concepts、Files and Code Sections（含代码片段与为什么重要）、Errors and fixes（含用户的纠正）、Problem Solving、All user messages（列出全部非工具结果的用户消息，安全相关的约束原文保留）、Pending Tasks、Current Work、Optional Next Step（引用最近对话的原话，防止跑偏），包在 `<summary>` 里。提示词有多个变体：先写 `<analysis>` 再写摘要、限 2000 词、再次压缩时“原样抄录旧摘要里用户要求的部分、只重写工作记录”、一句话的简短版本；用户可以在项目说明里写“压缩时关注什么”（`## Compact Instructions`），提示词要求遵守。
- **压缩后还放回什么**：系统提示词、项目说明与记忆文件原样；最近读过的至多五个文件从磁盘重新读入（长的截断）；计划、加载过的 Skill、后台代理与命令的状态；完整对话记录在磁盘上的路径（需要原文时去读）。提示词据此要求摘要“能再取到的细节只留一个指针（路径、命令、名称）”。

### 7.3 phistory

[WEIFENG2333/phistory](https://github.com/WEIFENG2333/phistory) 按版本存各家 CLI（Claude Code、Codex、omp、DeepSeek Harness 等）第一次请求的完整系统提示词（`captures/<工具>/<版本>/variants/<变体>/prompt.md`）；压缩请求不在其中（2026-10-28 浅克隆检索，Claude Code 只有 default、sdk 两个变体）。

## 8. shell 工具、执行时限与后台任务（2026-10-28）

### 8.1 omp 18.12.3（源码核实，`pi-coding-agent/src/tools/bash.ts`、`tool-timeouts.ts`、`exec/settings.ts`、`tools/settings.ts`、`tools/wait.ts`、`internal-urls/proc-protocol.ts`）

- 工具名 `bash`（设置里叫 `bash.*`），命令由 `pi-natives` 内嵌的 brush shell 执行（`executeShell`、`Shell`），不依赖系统的 bash。`pi-natives` 另有原生的 `grep`、`glob`、`fuzzyFind`。
- 执行时限：参数 `timeout` 以秒计，缺省 300，范围 1 到 3600，0 表示不设；全局 `tools.maxTimeout` 可以封顶（缺省 0 即不封顶）。
- 后台：参数 `async: true` 把命令放到后台（`async.enabled` 缺省开，`async.maxJobs` 缺省 100）；`bash.autoBackground.enabled` 缺省开，命令跑过 `bash.autoBackground.thresholdMs`（缺省 60 秒）自动转后台、结果稍后送达。另有“服务”形态（等日志里的就绪行或端口）。`wait` 工具阻塞等自己启动的后台任务（上限 30 分钟），期间来了消息也会结束等待。`proc://` 读任务状态与输出、写 stdin、结束任务。
- 其它：`bash.allowCompoundCommands` 缺省关；有 git 守卫、按模式拦截命令的设置。

### 8.2 Claude Code（本会话自己的工具定义，2026-10-28）

- Bash 的 `timeout` 以毫秒计，缺省 120,000（2 分钟），前台命令上限 86,400,000。
- `run_in_background: true` 后台运行，不用 `&`；命令结束时宿主重新唤起 Agent（通知），要求不要轮询输出文件；前台 `sleep` 被拦。
- Monitor 工具把一个长期运行脚本的每一行 stdout 当作事件推给 Agent（缺省 5 分钟、最多 30 分钟后到期，可重挂）；TaskStop 结束后台任务。

### 8.4 omp 的 eval 与 Agent Hub（源码核实）

- **eval**（`src/tools/eval.ts`、`src/eval/`、`src/prompts/tools/eval*.md`）：一个常驻的内核，后端是 Python 子进程（不是 IPython）或 Bun 的 JS；每次调用执行一个单元，顶层状态跨调用保留，压缩之后也保留，内核丢了会提示重新加载。单元里可用的内置函数：`read`、`write`、`env`、`output`（读后台任务的输出）、`tool.<名>(args)`（在代码里调用会话里的任意工具）、`wait`；`judge`、`judge_batch`、`completion`（在代码里调模型做分类、批量判断与补全）；`agent`、`workpool`（在代码里派后台子代理、按 DAG 分波次，结果自动送达）；`budget`（额度）；`@tool`（在内核里定义新工具给子代理用）；`%pip`、`%bun add` 装依赖，`%load` 载入脚本。单元也会自动转后台。即 CodeAct：模型写代码来编排工具、模型调用与子代理，而不是一次调一个工具。
- **Agent Hub**：斜杠命令 `/hub` 打开的终端界面浮层，分 agents 与 activity 两块，列出在跑与已落盘的子代理、活动流，可以切到某个子代理的会话（`modes/controllers/selector-controller.ts`）。是给人看的界面，不是模型的工具。

### 8.3 NeuroBook 的部署形态（ADR 0033，核实）

- 已有：npm 包 `@notnotype/neuro-book`，运行时用用户自己的 Bun（`bun add -g`），依赖全部打进 bundle。
- 待另写提案（ADR 0033 决定 6）：随发行捆绑 Bun 的目录包；原生窗口的桌面壳（Electrobun、Tauri、Electron 实测后选，都把 Bun 当独立进程）；服务器部署。

## 9. 钩子（2026-10-28）

### 9.1 OMP 与 omp（源码核实）

- `pi-agent-core` 的循环钩子：`transformContext`（每次请求前改上下文）、`transformProviderContext`（改交给服务商的上下文）、`beforeToolCall`、`afterToolCall`、`getSteeringMessages`、`getFollowUpMessages`、`convertToLlm`（`src/types.ts`）。
- omp 扩展（`~/.omp/agent/extensions/*.ts`）可订阅的事件（`extensibility/extensions/types.ts`、`shared-events.ts`）：会话类 `session_start`、`session_before_switch`、`session_before_branch`、`session_before_compact`、`session_compact`、`session_before_tree`、`session_shutdown`、`session_stop`；循环类 `context`（可替换本次请求的消息）、`before_agent_start`（可加一条消息、改系统提示词）、`before_provider_request`、`after_provider_response`、`turn_start`、`turn_end`、`agent_start`、`agent_end`；工具类 `tool_call`（可 `block` 并给 `reason`）、`tool_result`（可替换 `content`、`details`、`isError`）、`tool_execution_*`；另有 `input`（可改写或接管用户输入）、`before_subagent_spawn`（可换模型或拦下）、`tool_approval_requested`、`assistant_message`（可改写助手消息内容）、`auto_compaction_*`、`auto_retry_*` 等。处理函数签名 `(event, ctx) => result | void`。
- 各事件能返回的东西（`extensions/types.ts`、`shared-events.ts`）：`input` 可以改写用户输入的文字与图片，或声明已接管（`handled`）；`context` 可以替换本次请求的整个消息列表（不落盘，下一个处理函数拿到上一个的结果）；`before_agent_start` 可以加一条消息、替换系统提示词（按顺序串接）；`before_provider_request` 可以改原始请求体；`assistant_message` 可以改写助手消息里文字块的内容（块的位置与其它块不能动）；`tool_call` 可以拦下（附理由）、换掉执行用的参数（换后的参数重新按 schema 校验，也是审批时用户看到的参数）、附加给下一次请求的上下文；`tool_result` 可以替换内容、`details`、`isError` 并附加上下文；`session_stop` 可以让会话继续并附上下文（兼容 Claude Code 的 `decision: "block"`）；`session_before_compact` 可以取消压缩或直接给出压缩结果，`session.compacting` 可以追加摘要要保留的内容、替换压缩提示词、存自定义数据；`session_before_branch`、`session_before_tree`、`session_before_switch` 可以取消或给出自定义摘要；`before_subagent_spawn` 可以换模型或拦下。
- 合并与出错（`extensions/runner.ts`）：按扩展加载顺序逐个执行；`tool_call` 里拦下即短路，换参数取最后一个（每个处理函数看到的都是原始参数），附加上下文按顺序累积去重；`context` 串接；处理函数缺省时限 30 秒，`session_shutdown` 2 秒；`tool_call` 的处理函数超时或抛错按拦下处理。
- 处理函数手里的主动能力（`ExtensionAPI`、`ExtensionContext`）：注册工具、斜杠命令、快捷键、命令行参数、消息渲染器、服务商；`setActiveTools` 改当前工具集；`sendMessage`、`sendUserMessage` 往会话里发消息；`appendEntry` 写自定义会话条目；`setModel`、`setThinkingLevel`、`setSessionName`；`exec` 执行命令；`compact()`、`abort()`；`runEphemeralTurn` 做一次不进会话的模型调用；`invokeTool` 调工具；`addAdditionalContext`；定时器；界面对话框与小部件；读会话、上下文用量、后台任务快照、系统提示词。

### 9.2 Claude Code（官方文档 [Hooks reference](https://code.claude.com/docs/en/hooks)，2026-10-28 读取前 100,000 字）

- 33 种事件，常用的：`SessionStart`（加上下文）、`UserPromptSubmit`（拦下提示、加上下文，**不能改写用户的话**）、`PreToolUse`（放行、拒绝、询问或推迟；改参数 `updatedInput`；加上下文）、`PermissionRequest`、`PostToolUse`（拦下即把反馈交给模型、替换结果 `updatedToolOutput`、加上下文）、`PostToolUseFailure`、`PostToolBatch`（拦下即停止循环）、`Stop`（拦下即让对话继续，并加上下文）、`SubagentStart`、`SubagentStop`、`PreCompact`（拦下压缩）、`PostCompact`、`PreModelSwitch`、`SessionEnd` 等。只有 `PreToolUse`、`PermissionRequest`、`PreModelSwitch` 能放行，其它事件只能拦、改写或加上下文。
- 钩子的实现形态有 command（shell 命令，JSON 进出）、http、prompt（让模型判断）、agent、mcp_tool；按匹配器（例如工具名）选中。
- 同一事件的所有匹配钩子并行运行（prompt、agent 类最多同时 12 个）；完全相同的处理器去重。缺省时限 command、http、mcp_tool 600 秒，prompt 30 秒，agent 60 秒；`UserPromptSubmit` 等降到 30 秒，`SessionEnd` 共用 1.5 秒。`PreToolUse` 超时不拦，除非设了 `onFailure: "block"`；退出码 2 一律拦下；不表态不等于放行。多个钩子决定冲突时的优先规则在已读部分没有写明。

## 未验证边界

- omp 18.12.3 与仓库锁定的 18.2.5 之间，`pi-coding-agent` 以外的包是否有与本文相关的变化，没有对照。
- 两家模型接口的工具搜索没有实测；OpenAI 的模型范围来自第三方资料。
- `pi-natives` 的 brush shell 在仓库锁定的 18.2.5 里有没有、在 Windows 上能不能用，没有核实。
- Claude Code 的压缩提示词是二进制里的字符串，哪个变体是线上缺省没有查明（有 A/B 变体表）。
- omp 包内 `docs/*.md` 的正文（打包在 `dist/docs-index.generated.txt`，经压缩编码）没有解码阅读。
