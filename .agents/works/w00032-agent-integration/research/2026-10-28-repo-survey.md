# 仓库内 Agent 相关的现状（2026-10-28）

- 问题：接入 Agent 之前，仓库里已有什么：harness 的两条线、新应用的现状、文档的状态与冲突、其它 Work 里没做完的相关事项、旧应用的 Agent 功能面、nb-story 问答的预演。
- 方法：本会话读 Spec、提案与分支记录；四个只读子代理分别走查旧应用、nb-story、现有文档与各 Work 的记录。**核实**为本会话读过原文，**走查**为子代理静态阅读、本会话未逐条复核。
- 外部参照（omp、DeepSeek Harness、模型接口的工具发现）见 [`docs/research/agent-runtime-references.md`](../../../../docs/research/agent-runtime-references.md)。
- 本文只记事实；建议与讨论在 [t01 的报告](../tasks/t01-survey/artifacts/report/index.html)。

## 1. harness 的两条线（核实）

| | 分支 `feat/w00002-harness-kernel` | master |
|---|---|---|
| 时间与规模 | 2026-10-10 到 10-11；比 master 多 85 个提交，落后 master 2294 个提交；从 `refactor/w00017-runtime-foundation`（`ebecf836`）开出；没有 push、没有合入 | 2026-10-15 起，w00002 t21 为 nb-story 问答做，之后随 nb-story 的 Task 修正 |
| 设计 | 提案 `docs/proposals/agent-harness-kernel.md`（accepted，只在分支上）；8 份 Spec `docs/specs/harness/*`（分支上 implemented） | 提案 [`nb-harness-profile-and-tools.md`](../../../../docs/proposals/nb-harness-profile-and-tools.md)（accepted）；Spec [`agent/harness.md`](../../../../docs/specs/agent/harness.md)（planned，代码已大体实现） |
| 包 | 只有 `nb-harness`，按模块子路径导出（session、profile、config、models、tools、compaction、runtime）；删掉了 `nb-session`、`nb-profile` | `nb-harness`、`nb-session`、`nb-profile` 三个包 |
| OMP | 升到 18.4.6（t18） | 18.2.5 |
| 已有能力 | 会话条目带 `id`、`parentId`（v1 只用一条链）；审批（OMP 的三档等级、四种模式、审批模型、宿主审批回调）；插话与排队（steer、followup）；提问通道（`ToolContext.ask` 进日志与待处理，可在重启后回答）；配置 schema 与快照；模型角色解析；OMP 凭据存储与 OAuth 登录接口；`soft` 压缩；资源地址 `project://`、`local://`、`tmp://`、`docs://`、`artifact://`；工具结果超预算溢出到 artifact；插件扩展点（工具来源、拦截器、运行时级订阅、资源方案运行期登记）；上下文槽 `<Slot>`；运行期更换配置与 Profile、Profile 文件改动后重载；插件工具 id 换成服务商接受的名字（`/` 换 `__`、`.` 换 `_`） | Profile 声明工具（必需、可选、自带），生效工具集与会话快照；`TurnResult`（停止原因、错误归类、用量与是否完整）；收尾工具；单次请求 `complete()`；只用指定的密钥环境变量、错误正文里的密钥遮盖；进程中断与停服收尾；相邻 user 消息合并；流结束没有 `finish_reason` 时记截断；模型目录（`listCatalog`、`clampEffort`、`providerKeyReady`） |
| 明确不做 | 第一批不做：子代理、Skills、Workflow、附件与图片、会话分支与重试树、`request_user_input`、结构化结果 | 工具发现；给所有 Profile 的公共工具；用配置给 Profile 追加工具；工具审批；步数上限；上下文压缩；模型角色 |
| 待办 | t17 到 t20 标“待开发者评审”；t20 的 5 条待确认没追认（插件 Slot、ask 与 yolo、提问后重启回答、插件工具名换算、在 interaction 事件里立即应答） | Spec 未晋升，进程中断一条在 Spec 里仍标 planned |
| 使用方 | 没有 | nb-story 的问答（`@notnotype/nb-story` 已发 npm）；nb-agent-ui 的 `createHarnessTranscript` 适配器 |

master 上的记录（w00002 主工作区的 README 停在 2026-09-22、t21、w00024 t05、10-15 的提案）都没有提到这条分支，也没有写为什么另起一条线。分支的 Work README 记着：开发者看完快速开始，认为“骨架难用”，随后做了 t19 易用性。

**分支为什么去掉 nb-session、nb-profile**（核实，分支上的提案与 w00002 调研）：

- 不是去掉能力，是把三个包并成一个包：两个包的内容按新设计重写，成为 `nb-harness` 的 `session`、`profile` 子路径模块（提案“模块划分与推进顺序”一节）。
- 决策记录：开发者 2026-10-10 定“`nb-session`、`nb-profile` 并入 `nb-harness`”，备选表写“三个包 / 一个包：一个包，子路径导出（开发者 2026-10-10 同意合并）”，没有写更多理由。
- 同一偏好更早出现在 2026-09-11 的[包结构调研](../../w00002-neuro-agent-harness-redesign/research/2026-09-11-package-map.md)。当时讨论的是通用工具包（`agent-sse`、`agent-file-tools`）怎样聚合，后来这层通用包在 09-18 整体删除。开发者反馈“每个领域一个包偏散，倾向把 agent 相关能力聚合，或不拆包、按命名空间组织”；建议方案 A 是“单包加子路径：一个包、一个版本、一个 CI 条目、一份依赖集，将来某个成员要独立演进时再拆出去”。
- 当时两个包没有使用方：提案“影响”一节写“现有包没有使用方，不需要迁移”。nb-story 是 2026-10-15 之后才开始依赖它们的。
- 新格式与旧格式不兼容：会话条目改成与 OMP 兼容、带 `id` 与 `parentId` 的树；Profile 改成节点、数据源与字段都可注册的主机。旧包无法原样保留。

## 2. 新应用的现状（走查，关键处核实）

- `packages/neuro-book/src/plugins/` 下没有 agent、models 插件；`package.json` 不依赖 nb-harness、nb-profile、nb-session、nb-history。nb-agent-ui 只在 Lab 的场景里用到。
- 工作台外壳已有右栏（`auxiliarybar`）与面板（`panel`），插件视图可以放进去（[`ui/workbench-shell.md`](../../../../docs/specs/ui/workbench-shell.md)，implemented）；对话视图的 Spec 没有指定落位。
- 设置：`secret` 字段声明为真时被拒，密钥存储没有实现（[`settings/configuration.md`](../../../../docs/specs/settings/configuration.md)）；w00027 t08 密钥存储已搁置，2026-10-20 定 API Key 用明文的普通配置项。
- 命令系统（[`workbench/commands.md`](../../../../docs/specs/workbench/commands.md)，implemented）：
  - 暴露级别 never（缺省）、confirm、auto；
  - `nbook.commands/remote` 的 list 与 execute，来源记为 `agent:<调用方>`，第一版只允许服务端调用；
  - discuss、plan 模式下拒绝写入类命令；每次执行留一条审计。
  - 文中写明“产品命令表在 Agent 接入前没有确认通道”，`confirm` 级命令返回 `confirmation-required`；外部 Agent 的接入通道（命令行、MCP、Skill 绑定）不在本批。
- 资源地址（[`workspace/resources.md`](../../../../docs/specs/workspace/resources.md)）：
  - 写法是 `方案://路径`；`project://`、`user://` 已实现；
  - `projects://`、`tmp://`、`local://`（Agent 会话的工作目录）、`docs://`（产品参考文档，只读）是 planned；
  - 插件注册新方案的接口是 planned；列出、glob、grep、bash 是 planned。
- 命令行（[`runtime/cli.md`](../../../../docs/specs/runtime/cli.md)）：只有 `start` 与 `plugin`；明写没有作品管理的子命令。

## 3. 文档的状态与冲突（走查，前三条核实）

1. `local://` 有两个意思：资源 Spec 里是“Agent 会话的工作目录”，[`ui/prompt-editor.md`](../../../../docs/specs/ui/prompt-editor.md) 里是“会话内附件的短地址”（`![image #N](local://…)`）。
2. History 的归属：[文件底座提案](../../../../docs/proposals/project-file-foundation.md)写内置插件 `nbook.history`，[平台提案](../../../../docs/proposals/extensible-application-platform.md) P9 把 History 放进 `nbook.project`。
3. [模型角色合同](../../../../docs/proposals/model-roles-contract.md)（accepted，2026-09-10）引用的还是旧应用的代码路径，`specs` 为空。
4. [`ui/agent-conversation-view.md`](../../../../docs/specs/ui/agent-conversation-view.md) 是 planned，实现合同写“尚未实现”，nb-agent-ui 的组件已在 Lab 里运行；视图验收引用的 `/compact` 命令只在 Lab 场景里出现。
5. master 的 harness 提案写“经 OMP 的 `syncContextBeforeModelCall`”，代码用的是 `addBeforeModelCallHook` 加 `transformContext`。
6. Workflow 与 Agent 的关系没有合同：nb-workflow 只被旧应用依赖，对话视图里有 `run_workflow` 节点与 `workflow.submit` 动作。
7. 产品 Skill 的位置：`.agents/skills/README.md` 写“新应用的产品资产位置随 Agent 插件迁回时确定”。

## 4. 其它 Work 里相关、没做完的事项（走查）

| 事项 | 状态 | 与本 Work 的关系 |
|---|---|---|
| w00019 t11 对话视图完整版 | planned | 剩工具与条目渲染器、就地编辑、横幅、提问向导、顶栏、面板、待处理区、状态栏、弹窗与 19 条场景的验收，即 Composer 与人在回路的界面部分 |
| w00025 t12 行内 AI 编辑器接口 | planned | 记录写明 Agent Work 要在编辑器里改写正文时开工 |
| w00028 t03 共享包文字迁移 | active，分支 `feat/w00028-i18n` 已提交 4 片 | nb-agent-ui、nb-markdown、nb-form 的文字改成目录与 `TextResolver` |
| w00031 t03 失败投影 | active | 错误改成错误码加参数，包括 harness 工具结果的 `details.code` |
| w00027 的后续事项 | 未建 Task | 内置插件都没有按需激活事件；“装好后让 Agent 写插件”（Creator）；生成式视图；缺的贡献点 |
| w00027 t01 规范收口 | active | 插件清单、安装、代码加载、热插拔等 7 份 planned Spec 的缺口 |
| w00024 nb-story | 进行中 | t24 上下文构成与分项用量、t15 的 Responses 真实模型冒烟没做 |
| w00026 布局包、w00029 与 w00030 nb-ui 整理、w00025 其余 Task | planned 或暂停 | 对话视图放进右栏或面板不碰布局层；Agent 写入正在编辑的文件时，编辑器 Spec 输出 16 已覆盖（dirty 时标“磁盘已变化”） |

## 5. 旧应用的 Agent 功能面（走查）

旧包 `packages/neuro-book-legacy`，归档 Spec 在 `docs/archived/specs/agent/`。

- **Profile**：
  - TSX 写的 `defineAgentProfile`，字段有 manifest、initialSchema、payloadSchema（每轮结构化输入）、outputSchema（结构化结果）、settingsForm（低代码设置表单，人设与文风预设）、tools 与 toolKeys、`skills.include`、runtime 与 runtimeDefaults、context 或 prepare；
  - 存放分内置（14 个）、用户级、项目级 `.nbook/agent/profiles` 三层，编译产物另存；
  - profile home 是 `<项目>/agents/<profileKey>/`；用户可以从模板新建 Profile。
- **调用**：人和 Agent 走同一个 `invokeAgent`，只差调用方类型（user、agent、system）；Workflow 经端口复用同一入口。
- **多 Agent**：`create_agent` 可带父会话，父会话记一条关系条目；`invoke_agent` 前台阻塞，或后台作为 job 运行、结果作为后续消息回流；另有 `detach_agent` 与关系列表。同一会话忙时，`steer` 注入当前运行，`prompt`、`followup` 排队。
- **工具**：
  - 文件：read、write、edit、apply_patch、bash；
  - 剧情读写 15 个；execute_sql；变量 3 个；execute_world；主题记忆 3 个；web_search、web_fetch；
  - Workflow 与 job 5 个；Agent 协作 6 个；request_user_input、switch_mode、report_result。
  - 工具声明有三种标记：要审批、要用户输入、会写工作区。discuss、plan 模式下对“会写工作区”的工具注入写审批，plan 目录豁免；bash、execute_sql、execute_world 没标“会写”。
- **人在回路**：`request_user_input`（标题、问题、选项）让运行进入等待，用户提交答案后转成工具结果；`switch_mode` 是“批准、拒绝”表单；Workflow 的 `wf.ask` 在 Composer 下方的待处理区作答。
- **会话**：
  - `.nbook/agent/sessions/<id>.jsonl`；条目带 `parentId`，当前叶子回溯出活动路径；
  - 会话命令有 new、archive、restore、compact、mode、model、thinking、rename、summarize、retry、fork、tree；
  - 消息上可以复制、编辑重发、重新生成、从此处分支、切换兄弟分支；`/clear` 与 `/fork` 不删历史；
  - 自动压缩（预留 25600 token，保留最近 24000 token）加手动 `/compact`；
  - summarizer 每 16 次调用生成标题与摘要；会话可归档与恢复。
- **Composer**：
  - 模型选择（可选角色或具体模型）；推理档 off 到 max；模式 normal、discuss、plan；
  - 图片附件（最多 8 张、单张 16 MB，按内容哈希存在 `.nbook/agent/attachments/`）；
  - 斜杠命令 9 个；触发符 `/`（命令）、`$`（Skill）、`@`（章节、卷、设定集等引用）；
  - 状态栏有上下文占用（点开是上下文检查器）、累计用量、缓存命中率、累计费用；
  - 草稿持久化（10 条、30 天过期）。
- **nb-history**：
  - Agent 写文件前后记账（`actor: agent`），人写的记 user，外部修改由文件监听补记 external；
  - 收件箱可以接受、还原、全部接受，带修订号校验；
  - Profile 的 `fileChangeAwareness` 三档，每轮告诉 Agent 上次之后谁改了哪些文件。
  - nb-history 的时间线、误删找回、会话游标，旧应用没有用上。
- **记忆、Skill、文档**：
  - Profile 上下文记忆在 profile home 的 context.md、memory.md；
  - Skill 分安装层与项目层，同名整体覆盖，可运行的 Skill 带 package.json，内置 17 个；
  - 项目模板带 `AGENTS.md`，主创 Profile 用 `<Import path="AGENTS.md" />` 注入。
- **模型服务**：服务商模板来自 pi-ai；自定义服务商、模型发现；API Key 存在配置里、读取时脱敏；有模型角色设置界面（tiny、fast、main、deep 与专精角色），运行时接线没有找到。
- **操作应用**：经可写的客户端变量打开工作台面板、切换主题；没有改应用设置与模型配置的工具。
- **提示词资产**：14 个内置 Profile（主创、写手、导演、行内编辑、研究、检索、记忆整理、摘要、世界引擎、角色扮演两个、模拟两个等）、53 个文风预设、Profile 编写指南等参考文档。
- **已知教训**：
  - w00004：强制中止要经会话写入队列结算；
  - w00014：发送的归属绑在面板组件实例上，导致行内 AI 静默失效；
  - w00010：Profile 的 `Import` 依赖 `import.meta.dirname`，打包后缺失；
  - 旧状态记录写着：文件、SQLite、History、会话 JSONL、Job JSON 之间没有全局事务。

## 6. nb-story 问答的预演（走查，关键处核实）

- **形态**：独立应用加 npm 包，不是 NeuroBook 插件；运行时依赖 nb-harness、nb-profile、nb-session，网页用 nb-agent-ui、nb-markdown、nb-form。
- **接法**：
  - 每轮新建工具登记表、`registerPlugin`、`createHarness`、`turn`、`close`；续问从会话快照恢复，版本不符转成“不能续问”；
  - Profile 是 TSX（`story-qa`，第 4 版）；工具 id 是 `story.<命令名>`，模型看到的是命令名；
  - 工具参数直接取查询合同的 TypeBox schema，去掉由程序固定的字段（书、阅读位置）；
  - 收尾工具 `answer` 校验不过就退回。
- **存放**：记录与会话日志在书库的 `qa/` 目录；运行期间只在内存，每轮结束写新的日志文件，再一次改名发布记录（成对保存）。
- **模型**：自己的 `config.json` 只写密钥的环境变量名；密钥只认进程启动时的环境（ADR 0032）。
- **运行与推送**：一轮在服务进程里跑，不绑页面连接；事件经 SSE 推送，更新每 100 毫秒最多一次，积压超过 2 MiB 断开，页面重连后补齐；前端用 fetch 加 `eventsource-parser`，不用 `EventSource`。
- **Skill**：随包的 `skill/SKILL.md` 与 `references/`，没有 package.json 与脚本；`nbstory skill install` 装到 `~/.claude/skills` 或 `~/.agents/skills`，先写临时目录再改名。
- **踩过的坑**：
  - OMP 一导入就接管 SIGINT，要用 `onProcessInterrupt`；
  - OMP 异步投递事件，并行工具的结果可能晚于下一次请求；
  - 工具名与 nb-agent-ui 的内置工具 `read` 同名会冲突；
  - 余额不足的 403 被误归成 `auth`；
  - DeepSeek 等端点拒绝连续的 user 消息；
  - 自定义模型不写 `maxTokens` 时被网关静默截断；
  - 不设推理档时错误率高（168 题错 38，设 xhigh 后错 11）；
  - OMP 自带 6 次重试与 minimal 降档且关不掉，抽取因此绕开 nb-harness 直连；
  - `additionalProperties: false` 的参数会被 OMP 删字段；
  - Bun 读 cwd 的 `.env`、OMP 又合并家目录的 `.env`，同一变量在不同命令里结论不同。
- **它绕开、应用里要正面解决的**：模型与密钥要接应用的模型服务；会话存放要定在插件数据还是项目目录；`agent.tools` 贡献点还没有实现；删除、停服、插件停用时要先停掉运行中的轮次；Markdown 与结构化两种作答方式的取舍；费用“未知”与“免费”的区分。
