# Sidecar Profile Pass

`SidecarProfilePass` 是 profile 声明的旁路 run。它沿用当前 profile、当前 session、当前 session tree 和当前 input，在主 run 前后 fork 一段 runtime-only 分支，完成检索、反思或维护任务后，通过 `merge()` 把结果注入主线或持久化到主 session。

它不是新 profile，也不通过 `profileKey` 切换身份。

## When To Use

适合：

- `actor.context-load`：actor 主 run 前检索并整理角色可知设定。
- `actor.memory-save`：actor 主 run 后维护 `events.jsonl`、`memory.jsonl` 和 `mind.md`。
- writer 写作前检索相关 lorebook。
- simulator leader 推进前做规则审计。

不适合：

- 确定性上下文注入。确定性内容继续用 profile TSX、input schema、variables 或 `<Import />`。
- agent 主动临时切换 profile。V1 只支持 profile 声明式自动旁路。

## V1 Contract

```ts
type SidecarProfilePass<TInput, TSidecarData> = {
    name: string;
    stage: "prepareRun" | "settleRun";
    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);
    allowedToolKeys?: readonly string[];
    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge: (ctx: SidecarContext<TInput>, result: SidecarResult<TSidecarData>) => SidecarMergePlan;
};
```

V1 规则：

- `stage` 只支持 `prepareRun` 和 `settleRun`。
- sidecar 自己的 assistant / toolResult transcript 默认 `runtime_only`，不进入主 history。
- 禁止 nested sidecar。
- sidecar 失败、waiting、schema 校验失败或缺少必要结果时，父 run 失败。
- `allowedToolKeys` 必须是当前 profile `allowedToolKeys` 的子集。
- provider-visible tools 保持 profile 最大集合，避免破坏工具/schema 缓存；实际执行权限由执行层控制。
- profile 可声明 `mainRunAllowedToolKeys` 限制主 run 可执行工具；不声明时主 run 默认可执行全部 `allowedToolKeys`。sidecar 仍使用自己的 `allowedToolKeys` 执行子集和 reminder。

## Result And Merge

`report_result` 固定支持：

```ts
type ReportResultArgs = {
    result: string;
    data?: JsonValue;
    sidecar_data?: JsonValue;
};
```

- 主路结构化输出使用 `data`。
- sidecar 结构化输出使用 `sidecar_data`。
- `sidecarDataSchema` 只在 Harness runtime 校验，不参与 provider-visible schema 渲染。
- 没有 `report_result` 时，可按 `outputFallback` 使用最后一条 assistant message。

`merge()` 可以返回：

- `runtimeMessages`：注入父 run 模型上下文，不落 session。
- `persistedMessages`：写入父 session active path，并在 `prepareRun` 本轮主 run 可见；第一版只允许 user message，写入 origin 为 `harness`。
- `runtimeState`：写入父 run runtime state。
- `writePlans`：显式持久化 session custom state 或 projection。

V1 推荐只在 `prepareRun` 使用 `persistedMessages`，用于“本轮需要像用户消息一样进入历史”的上下文。`settleRun` 虽可返回 `persistedMessages`，但它只会成为未来可见历史；维护状态仍优先使用 `writePlans` 或文件工具。`prepareRun` sidecar 合并后会做一次 provider-visible context 预算检查，超出模型窗口时父 invocation 直接失败，已写入的 persisted message 不回滚。

## Roleplay Actor Pattern

`actor.context-load`：

- stage: `prepareRun`
- tools: `subject_rag_search`, `read`, `report_result`
- 输入：actor-facing packet、actor path、当前 subject files。
- 输出：actor-safe current context、相关过往经历和相关稳定认知。
- 检索：`subject_rag_search` 只检索当前 subject 的指定单一 source；必须显式传 `["events"]` 或 `["memory"]`，需要两层记忆时分两次调用；查询调参第一版只使用 `limit`，不检索 lorebook、Project 全局文件或其他 subject。
- merge：把 actor-safe 摘要以 `persistedMessages` 写入 actor session，并注入 actor 主 run；主 run 不直接读取完整 subject files。
- 预算：第一版最多注入少量 events / memory 摘要，合并后若 provider-visible context 超出模型窗口，父 invocation 失败。

`actor.memory-save`：

- stage: `settleRun`
- tools: `subject_event_append`, `memory_bio`, `read`, `edit`, `report_result`
- 目标：追加 `events.jsonl`，通过 `memory_bio` 维护 `memory.jsonl`，并更新 `mind.md`。
- 不更新 `state.md`；位置、持有物、伤势等仍由 simulator leader / 后续变量系统裁决。

Subject RAG 的索引、embedding 配置和工具合同见 [../content/subject-rag-memory.md](../content/subject-rag-memory.md)。

历史设计过程见 [../../docs/tasks/23-agent-sidecar-profile-pass/README.md](../../docs/tasks/23-agent-sidecar-profile-pass/README.md)。
