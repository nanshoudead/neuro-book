# t02 实施计划：错误处理只读审查与通道矩阵

## Context

ADR 0034（t01）定了：开发诊断用英文，用户可见的失败说明由界面按“拥有者命名空间 + 码”取文案，各错误域保留自己的合同。t03 要据此设计失败投影并切片迁移，但前提是知道现在每一条失败文字从哪里来、到哪里去、用什么语言、有没有落盘。前三轮讨论审查已经零散发现了一些通道（命令通知直接显示 `reason`、SSE 投影丢掉 `details`、nbdev 共用中文校验等），没有完整的盘点。本 Task 只读盘点，产出通道矩阵与错误码清单，不改代码。

开发者已确认的决定：见 Work README 第 1、2、5 条（先做只读审查，再设计投影，再迁移）。

工作方式：自主推进；按 reviewing 的“派给谁”分前后端：后端 omp 一个会话，前端 Claude Sonnet 一个子代理，各写一份分区报告；主会话合并成矩阵并抽查。

## 技术选型

无。

## 关键设计

### 盘点范围

排除清单之外的新应用与新包，按包与区域分：

- **后端（omp）**：`packages/nb-runtime`（remote、diagnostics、plugins、plugin-manifest）；`packages/neuro-book` 的 `src/server`、`src/backend`、`src/plugin-platform`、`src/project` 与各插件的 `backend/`、`shared/`；`packages/nb-harness`、`packages/nb-session`、`packages/nb-profile`；`packages/nb-story` 除 `web/` 外；`packages/dev-panel` 除 `web/` 外；`packages/nb-workflow`、`packages/nb-history`、`packages/nb-memory`、`packages/owned-process`、`packages/file-snapshot-cache`。
- **前端（Sonnet）**：`packages/neuro-book` 的 `src/web`、`src/ui`、各插件的 `web/`、`src/sdk` 与 `plugin-sdk/examples`；`packages/nb-agent-ui`（含 harness 适配器）、`packages/nb-form`、`packages/nb-markdown`、`packages/nb-ui`；`packages/dev-panel/src/web`；`packages/nb-story/src/web`。

### 每份分区报告的内容

1. **通道表**，一行一条通道，列固定：通道名；生产者（文件:行，代表位置即可）；消费者；现在的语言（中文、英文、混合）；是否显示给用户；是否进模型上下文；是否持久化（存在哪、格式）；有没有稳定码；旧数据怎么读；备注（迁移时的坑）。至少覆盖：诊断事件与查询、JSONL 日志、紧急输出、握手与跨进程 `detail`、命令失败结果与通知、贡献与清单校验的拒绝原因、HTTP 错误体、工具结果（内置、领域、第三方桥接）、运行中的 Agent 事件与 SSE、会话 JSONL（`agent_message`、`run_end.error`）、QA 记录、CLI 给人看的输出与 `--json`、nbdev HTTP `errors[].message`、共用的校验函数、界面直接显示 `message`/`reason` 的位置、Task 证据与测试断言。分区内没有的通道写“无”。
2. **错误类型与码清单**：每个 Error 子类或失败结果类型一行：所在包、有没有 `code`、码的取值（列全或给出来源文件）、与其它合同重名的码。
3. **计数**：带中文的错误构造、诊断与日志、`reason`/`message`/`detail` 字段、断言中文文字的测试文件，每项给出可复现的命令与口径（含不含测试、注释、领域文案）。
4. **发现**：盘点中看到的与 ADR 0034 冲突、或 t03 必须先定的问题，按报告格式逐条写。

### 合并产物

主会话把两份分区报告合并为 `artifacts/channel-matrix.md`：一张通道总表（按通道合并前后端的生产者与消费者）、错误码清单、计数表、给 t03 的问题清单（按“必须先定”“迁移时注意”分两级）。合并时抽查：每个分区随机挑 5 行，回到代码核对生产者、消费者与持久化是否属实，不符的回报给对应审查者或自己更正，抽查结果写进矩阵末尾。分区报告原文存 `evidences/`。

## Spec 与文档改动

无。矩阵是 Task 产物，不是 Spec。

## 切片

1. 两份分区盘点并行：omp（后端）与 Sonnet（前端），各自追加写报告。
2. 合并为 `artifacts/channel-matrix.md`，抽查，提交产物与证据。

## 验收映射

无 Spec 条目，行为合同未变。完成判据：上面“至少覆盖”的每条通道在矩阵里都有一行或明确写“无”；每个计数有可复现命令；抽查 10 行的结果写明。

## 验证

`bun run docs:check`、`bun run governance:check`（只验证产物文档的链接与结构）。盘点不跑测试。

## 不做与风险

- 不改代码、不改 Spec、不设计投影（t03）。
- 风险：盘点按名字推断通道的去向。对策：说明里要求每行给生产者的文件与行号，消费者要追到真实调用处；主会话抽查。
- 风险：前后端在同一条通道上各写半行（例如命令失败：后端生产、前端显示）。对策：两份报告都写“对侧消费者或生产者”的猜测位置，合并时以代码为准。
