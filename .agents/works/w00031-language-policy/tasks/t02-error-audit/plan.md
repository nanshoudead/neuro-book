# t02 实施计划：错误处理只读审查与通道矩阵

## Context

ADR 0034（t01）定了：开发诊断用英文，用户可见的失败说明由界面按“拥有者命名空间 + 码”取文案，各错误域保留自己的合同。t03 要据此设计失败投影并切片迁移，但前提是知道现在每一条失败文字从哪里来、到哪里去、用什么语言、有没有落盘。前三轮讨论审查已经零散发现了一些通道（命令通知直接显示 `reason`、SSE 投影丢掉 `details`、nbdev 共用中文校验等），没有完整的盘点。本 Task 只读盘点，产出通道矩阵与错误码清单，不改代码。

开发者已确认的决定：见 Work README 第 1、2、5 条（先做只读审查，再设计投影，再迁移）。

工作方式：自主推进；按 reviewing 的“派给谁”分前后端：后端 omp 一个会话，前端 Claude Sonnet 一个子代理，各写一份分区报告；主会话合并成矩阵并抽查。

## 技术选型

无。

## 关键设计

### 源码基线

两份盘点都读同一个 detached 审查 worktree（固定在开跑时的 `master` 提交），报告头写完整提交 ID；Work 与 Task 记录、ADR 读主工作区。计数与合并用同一基线。

### 盘点范围

排除清单之外的 16 个包。每个目录只有一个负责的分区；目录里有另一侧的代码时，由负责分区追到对侧，不按文件后缀或“examples 就是前端”判断：

- **后端（omp）**：`packages/nb-runtime` 整包；`packages/neuro-book` 的 `src/server`、`src/backend`、`src/project`、`src/cli`、`src/shared`、`src/plugin-platform`（含浏览器端的脚本装载失败，如 `code-load-failed`、`module-not-shared`）、各插件的 `backend/` 与 `shared/`、`plugin-sdk/` 里除 `examples/` 外的部分（作者 CLI、打包、模板）、包内 `scripts/`；`packages/nb-harness`、`packages/nb-session`、`packages/nb-profile`；`packages/nb-story` 除 `src/web/` 外（含 `skill/`）；`packages/dev-panel` 除 `src/web/` 外；`packages/nb-workflow`、`packages/nb-history`、`packages/nb-memory`、`packages/owned-process`、`packages/file-snapshot-cache`。
- **前端（Sonnet）**：`packages/neuro-book` 的 `src/web`、`src/ui`、`src/sdk`、各插件的 `web/`、`plugin-sdk/examples/`（含示例插件的 `backend/`、`shared/` 与场景测试）；`packages/nb-agent-ui`（含 harness 适配器）、`packages/nb-form`、`packages/nb-markdown`、`packages/nb-ui`；`packages/dev-panel/src/web`；`packages/nb-story/src/web`。

### 每份分区报告的内容

1. **错误域表**：每份独立的错误合同一行，给稳定的错误域 ID（例如 `remote.route`、`commands.result`、`diagnostics.store`）：所属命名空间、类型或 schema 与对应 Spec、版本（协议、schema、持久化）、码的字段路径与取值（或来源文件）、结构化参数的字段路径、与其它域重名的码、控制流语义（失败、取消、结果未知要分开）。
2. **通道表**，一行一条通道，列：通道 ID；错误域 ID；生产者（文件:行）；逐跳转换（每一跳写保留、改名、包裹、截断或丢失，以及在哪个文件:行）；消费者；现在的语言（中文、英文、混合）；显示给用户；进模型上下文；持久化（位置、格式、版本）；旧数据怎么读；备注。可以用结构化附件补充，但错误域 ID 与字段路径不能省。
3. **必查表**：按“错误域 × 承载路径”逐项写对应的通道 ID，或写“无”（确实没有）、“Spec 规划、未实现”、“未追到”（三者不能混用）。必查项至少包括：诊断事件与查询、JSONL 日志、紧急输出；握手 `reject`、连接结果、远程路由失败、业务 detail；命令失败结果与通知；贡献与清单校验的拒绝原因；插件安装、升级与启动未加载的状态；设置层的 invalid 快照与设置文件校验；Storage 的损坏、不支持的版本与订阅结束；项目子进程的启动、IPC 与输出转发；HTTP 错误体与中间件；工具结果（内置、领域、第三方桥接）；运行中的 Agent 事件与 SSE、权威日志补发、QA 降级回放；会话 JSONL（`agent_message`、`run_end.error`）；QA 记录；Workflow 的 Run 状态持久化与控制失败；History 的异常与不可用结果；CLI 给人看的输出与 `--json`（应用 `src/cli`、nbstory、nbdev、plugin-sdk 作者 CLI）；nbdev HTTP `errors[].message` 与共用的校验函数；界面直接显示 `message`/`reason` 的位置；Task 证据与测试断言。
4. **计数**：先按基线列出文件清单与计数单位（调用点，不是行），搜索结果只算候选；分别给原始匹配数与按调用边界核实后的分类数（诊断、用户文案、提示词、领域内容、无法分类），说明跨行与变量拼接怎么处理、去重键是什么。每项给可复现命令。
5. **发现**：与 ADR 0034 冲突、或 t03 必须先定的问题，按报告格式逐条写。

### 合并产物

主会话把两份分区报告合并为 `artifacts/channel-matrix.md`：错误域总表、通道总表（按错误域 ID 与通道 ID 合并前后端的生产者与消费者）、必查表、计数表、给 t03 的问题清单（分“必须先定”与“迁移时注意”两级）。

合并时核对：

- **定向核对高风险链路**：命令失败通知、SSE 与权威日志与 QA 降级、nbdev 共用校验、远程握手、状态型拒绝（设置 invalid、Storage 损坏），从生产者到消费者逐跳回到代码确认；
- **随机抽样**：每个分区再随机抽 5 行，核对生产者、转换、消费者与持久化，抽查表记下每个样本的字段路径与证据；
- **补漏**：对照必查表与全部目录，处理所有“未追到”；对侧位置在核实前不当作已证实。

分区报告原文存 `evidences/`。

## Spec 与文档改动

无。矩阵是 Task 产物，不是 Spec。

## 切片

1. 两份分区盘点并行：omp（后端）与 Sonnet（前端），各自追加写报告。
2. 合并为 `artifacts/channel-matrix.md`，抽查，提交产物与证据。

## 验收映射

无 Spec 条目，行为合同未变。完成判据：必查表每一项都有通道 ID，或写明“无”“Spec 规划、未实现”；合并后没有剩下“未追到”（追不到的写明原因并交 t03）；每个计数有基线、单位与可复现命令；定向核对与 10 个随机样本的结果写明。

## 验证

`bun run docs:check`、`bun run governance:check`（只验证产物文档的链接与结构）。盘点不跑测试。

## 不做与风险

- 不改代码、不改 Spec、不设计投影（t03）。
- 风险：盘点按名字推断通道的去向。对策：说明里要求每行给生产者的文件与行号，消费者要追到真实调用处；主会话抽查。
- 风险：前后端在同一条通道上各写半行（例如命令失败：后端生产、前端显示）。对策：用错误域 ID 关联；对侧位置在合并时回到代码核实，核实前不当作已证实。

## 审查处理（2026-10-27）

omp 计划审查（`evidences/plan-review-omp.txt`）有效 5 条，都已处理：补上 `src/cli`、`src/shared`、`plugin-sdk` 作者部分与 `scripts/`，写明每个目录一个负责分区、跨侧由它追（第 1 条）；加错误域表与错误域 ID、字段路径、逐跳转换、版本与控制流语义（第 2 条）；两份盘点读同一个固定提交并记下提交 ID（第 3 条）；加“错误域 × 承载路径”的必查表，区分“无”“Spec 规划、未实现”“未追到”（第 4 条）；计数先定基线与单位、候选与分类分开，合并时定向核对高风险链路再随机抽样（第 5 条）。
