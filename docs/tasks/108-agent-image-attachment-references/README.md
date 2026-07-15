# Agent 图片附件引用与持久化

## Relative documents refs

- [Agent Runtime Event OOM 与 SSE 内存边界](../107-agent-event-memory-boundaries/README.md)
- [Agent Chat Flow Snapshot 分页](../106-agent-chat-flow-pagination/README.md)
- [Agent Session Management](../15-agent-session-management/README.md)
- [Agent Turn Commit Boundary](../07-agent-turn-commit-boundary/README.md)

## User Request / Topic

- 真实 session 94 中存在约 9.56 MB 的单个 `read` tool result：512×768 PNG 被编码为 base64 image block，随后原样进入 tool result、append-only JSONL 和 provider context。
- Task 107 已让公开 SSE / `session_entry` 只返回图片 MIME、原始大小和 `dataOmitted=true`，但没有改变 JSONL 真相与模型消息中的内联图片。
- 本任务单独设计图片附件引用；Task 106 本轮不实现图片引用、附件读取或回收。

## Goal

让 Agent session 的图片消息和图片 tool result 不再把 base64 内联到 append-only JSONL，同时保持 Provider 能在需要时获得等价图片内容、session 重启后引用仍可解析、Project 生命周期与数据隔离不被破坏。以公开 session API、真实 provider message hydration 和重启恢复测试证明行为；Task 107 的公开事件仍保持有界，Task 106 只消费轻量图片 metadata。若当前 Pi message 类型或 Provider adapter 无法表达引用 hydration，先报告接口缺口，不在 JSONL 中塞自定义伪 URL 或前端路径 hack。

## Current State / Evidence

- `read` 工具读取图片时执行 `buffer.toString("base64")`，返回 `{type:"image", data, mimeType}`。
- `createToolResultFromResult()` 原样保留工具 content；turn commit 将 assistant + toolResult 写入 JSONL。
- session 94 的最大 entry 约 9,561,476 bytes，其中 `content[1].data` 约 9,560,920 个 base64 字符；`details` 只有约 136 bytes，不存在 details 重复正文。
- Task 107 的 `PublicToolContentDto` 已将公开图片收敛为 `{type:"image", mimeType, dataBytes, dataOmitted:true}`，因此本任务不再治理 SSE/replay/Chat Flow payload 上限。
- 当前 `ImageContent` 是 Provider/运行态类型，不应直接承担持久化引用合同。

## Design Direction

### 1. 持久化引用与运行态图片分层

- JSONL 使用 NeuroBook 自有的强类型图片引用，不直接保存 Pi `ImageContent.data`。
- Provider 调用前，在唯一 hydration seam 将引用解析回 Pi `ImageContent`；Provider 层不感知存储布局。
- Task 107/106 的公开 DTO只返回 attachment ID、MIME、原始字节数、可用状态等 metadata，不返回 base64。
- 不把绝对路径、`file://` URL 或临时路径写入 session。

### 2. Content-addressed attachment

推荐使用原始二进制 SHA-256 作为稳定内容 ID：

```typescript
type AgentImageAttachmentRef = {
    kind: "image_attachment";
    id: string;
    mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    bytes: number;
};
```

- 同一 Workspace Root 内相同图片只存一份。
- 落盘必须先写临时文件再原子 rename；JSONL 只能在 attachment durable 后追加引用。
- 读取时校验 ID、大小和允许的 MIME，不信任 JSONL 中的路径。
- 是否保存宽高属于后续 UI 需求；第一版不为展示预先引入图片解码依赖。

### 3. 存储边界

候选推荐：Workspace Root `.nbook/agent/attachments/<sha256>`，原因是 session JSONL 本身属于 Workspace Root 级 Agent 数据，Global/Project session 都由同一 repository 管理。

实现前必须核对：

- Project 删除是否应该删除附件，还是附件随 Workspace Root session 生命周期保留。
- 日志包、Project zip、Workspace backup 是否包含附件。
- 多 Project session 引用同一附件时的隔离与导出语义。

在这些语义拍板前，不实现引用计数或自动 GC。第一版允许保留未引用附件，比错误删除仍被历史 session 引用的图片更安全。

### 4. 写入入口

- `read(image)`：直接把读取到的 Buffer 交给 attachment store，不先创建长期 base64 字符串。
- 用户消息图片：HTTP/前端输入在进入 durable turn 前写 attachment，再把 session message 转为引用。
- 其他工具返回 image block：统一经过 turn commit 的 attachment normalization seam，避免每个工具各写一套。
- 已经是 attachment ref 的内容保持幂等，不重复读取/写入。

### 5. Provider hydration

- Provider 请求构建阶段只对本次可见 context 中的图片引用读取二进制并编码为 Provider 所需形式。
- hydration 数据只活在 invocation/turn 生命周期，不回写 JSONL。
- 缺失、损坏或 MIME 不匹配时返回明确的 session attachment error；不能静默丢图后继续生成。
- compaction、fork、retry、tree move 只复制/引用 ID，不复制附件正文。

### 6. 历史数据

- 项目处于快速开发阶段，不维护长期 legacy 双格式。
- 实施时先确定是否需要一次性迁移当前真实 session 中的 image base64；若迁移，必须先备份 JSONL、写 durable attachment、再原子重写 session 文件并验证引用。
- 若用户决定不迁移旧 session，则明确旧数据只读边界；不能让新代码在同一主路径长期维护两套持久化类型。

## Scope

### In scope

- attachment ref DTO、store、原子写入和校验。
- 图片 tool result / 用户图片的 durable normalization。
- Provider context hydration。
- session 重启、fork/retry/tree/compaction 下的引用正确性。
- 公开 Chat Flow 图片 metadata 与 attachment 可用状态。
- 与 Workspace Root 生命周期、备份和导出的明确合同。

### Out of scope

- Task 106 的 snapshot/history 分页。
- Task 107 的 SSE/replay/backpressure。
- 图片编辑、缩略图生成、OCR、压缩和格式转换。
- 通用任意文件附件系统；第一版仅覆盖现有 Pi image block。
- 未经生命周期设计确认的自动 GC。
- 浏览器图片画廊或复杂预览 UI。

## Verification / Test

- [ ] 读取 7 MiB PNG 后，JSONL entry 只增长轻量引用大小，不包含 base64 特征串。
- [ ] 同一图片重复读取只创建一个 content-addressed attachment。
- [ ] attachment durable 失败时不追加引用 entry。
- [ ] session 重启后 Provider hydration 得到与原始图片一致的 bytes/MIME。
- [ ] fork/retry/tree move/compaction 不复制图片正文且引用仍可解析。
- [ ] 缺失或损坏 attachment 返回明确错误。
- [ ] Task 107 的公开事件仍不返回图片 data。
- [ ] Task 106 recovery/history 只返回图片 metadata。
- [ ] Windows 路径、并发相同图片写入和原子 rename 有聚焦测试。

## TDD Implementation Walkthrough

1. Tracer bullet：通过公开 session 写入/读取接口保存一张图片，断言 JSONL 无 base64、Provider hydration bytes 相同。
2. 第二条：相同图片并发写入只产生一个 attachment。
3. 第三条：重启 repository/harness 后引用仍可解析。
4. 第四条：attachment 缺失/损坏产生明确错误，不静默降级。
5. 第五条：用户图片、其他工具 image block 统一进入 normalization seam。
6. 最后再决定旧 session 迁移与 GC；没有真实生命周期证据前不提前实现。

## Required Decisions

- [ ] 确认 attachment 存储根是否采用 Workspace Root `.nbook/agent/attachments/`。
- [ ] 确认 Project 删除、Project 导出和 Workspace backup 对附件的语义。
- [ ] 确认是否迁移当前已有 image-base64 session。
- [ ] 确认第一版是否需要通过授权 API 查看完整历史图片；若不需要，Chat Flow 只显示 metadata/省略状态。

## TODO / Follow-ups

- [ ] 核对 Pi Provider 输入 seam 与当前 user image HTTP 输入。
- [ ] 拍板存储和生命周期决策。
- [ ] 按 tracer bullet 实施 attachment store 与 hydration。
- [ ] 评估旧 session 迁移。
- [ ] 实施后更新 `PROJECT-STATUS.md` 和本 walkthrough。

