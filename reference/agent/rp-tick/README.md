# RP Tick Protocol

RP Tick 是 RP 模式下世界推进的最小单位。本目录定义 rp.leader、simulator.leader、simulator.actor、rp.writer 四个 profile 在一次 Tick 中的完整交互协议。数据层面的 simulation 目录结构和文件合同见 [simulation.md](../../content/simulation.md)。

## 文件索引

| 文件 | 内容 | 可被 Import 的 Profile |
|------|------|----------------------|
| [lod-simulation.md](lod-simulation.md) | LOD 世界模拟系统 | simulator.leader |
| [actor-facing-packet.md](actor-facing-packet.md) | Actor-facing packet 标签规范 | simulator.leader + simulator.actor |
| [subject-creation-guide.md](subject-creation-guide.md) | Subject 创建流程与设计方法论（7 步任务清单、调色盘、核心人格层） | simulator.leader |
| [adjudication-report.md](adjudication-report.md) | 裁决结果报告格式 | simulator.leader + rp.leader |
| [writer-brief.md](writer-brief.md) | Writer Brief 剧本格式 | rp.leader + rp.writer |
| [tick-002-example.md](tick-002-example.md) | 完整 Tick 002 示例 | 不 Import，仅供参考 |

**相关参考**：
- [subjects.md](../../content/subjects.md)：Subject 文件架构与分流规则（可被其他需要理解 subject 文件的场景复用）

## Tick Lifecycle

一次完整的 Tick 经历以下 5 个阶段：

```
Phase 0        Phase 1         Phase 2            Phase 3          Phase 4a        Phase 4b        Phase 4c        Phase 5
 IDLE ──────► rp.leader ──► simulator.leader ──► rp.leader ──► rp.writer ──► rp.leader ──► rp.writer ──► rp.leader ──► IDLE
              IC/OOC 审查     世界模拟 10 步        生成 Brief       素材检查         评估补充         渲染 prose      终稿组装
                                                                    与提问
```

### Phase 1 — rp.leader：IC/OOC 审查

rp.leader 接收用户输入后执行以下判断：

- **IC/OOC 检查**：区分用户消息属于角色内（In-Character）行为还是元层（Out-Of-Character）指令。OOC 指令直接处理，不进入后续 Phase。
- **合理性校验**：评估 IC 行为在当前世界状态下是否合理，必要时向用户发出澄清或拒绝。
- **输出**：仅将需要世界响应的变化（world changes，通常 1–3 行戏内事实）发送给 simulator.leader；不传递裁决问题、渲染指令或叙事偏好。

### Phase 2 — simulator.leader：世界模拟

simulator.leader 执行 10 步工作流，驱动世界状态向前推进：

- 完整流程定义见 [lod-simulation.md](lod-simulation.md)。
- 与 simulator.actor 之间的数据包格式遵循 [actor-facing-packet.md](actor-facing-packet.md)。
- 返回给 rp.leader 的裁决结果遵循 [adjudication-report.md](adjudication-report.md)。

### Phase 3 — rp.leader：生成 Writer Brief

rp.leader 根据 simulator.leader 返回的世界变化，组装一份 Writer Brief 剧本：

- Brief 格式定义见 [writer-brief.md](writer-brief.md)。

### Phase 4a — rp.writer：素材检查与提问

rp.writer 收到 Brief 后，先检查素材完整性并按需提问：

- **解析前情引用**：从 `<context_references>` 提取 prose 文件路径，按需 read（不强制全读）
- **检查素材完整性**：lorebook 引用是否明确？场景底色是否充分？人物情绪标签是否清晰？
- **提出问题**：0-5 个，优先问设定细节（lorebook 引用的材质、外观、规则），不问人物动机或剧情决策
- **输出**：`report_result({questions: string[]})`；空数组表示无问题，leader 直接跳到 Phase 4c

详细协议见 [rp-writer-interaction.md](rp-writer-interaction.md)。

### Phase 4b — rp.leader：评估并补充

rp.leader 逐条评估 writer 的问题：

- **合理问题**（设定细节）：检索 lorebook 或推理设定，补充素材
- **越界问题**（人物动机/剧情决策）：拒绝并说明理由
- **输出**：`supplemental_brief`（XML 格式），包含 `<answer>` 和 `<rejected>` 标签

### Phase 4c — rp.writer：渲染并写入 prose

rp.writer 融合 brief + supplemental_brief，执行多步渲染流程：

- 先打草稿、用 stop-slop skill 自查，再把成稿写入 Brief 指定的 prose 路径并润色。
- 仅依据收到的 Writer Brief 生成散文体叙事文本，不做逻辑判断，不修改 Brief 中的事实。
- prose 落点由 Brief 给出（典型为 `simulation/runs/ticks/{id}-{slug}/prose.md`）；Brief 未给路径时退化为直接输出文本。

### Phase 5 — rp.leader：终稿组装

rp.leader 接收 rp.writer 的渲染输出，完成最终组装：

- **Prose 组装**：校对叙事文本，确保与 Brief 事实一致。
- **Meta-scene 组装**：将本 Tick 产生的元数据（场景标签、状态变更摘要等）附加到输出，供下一次 Tick 的 Phase 1 消费。
