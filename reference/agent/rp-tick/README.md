# RP Tick Protocol

RP Tick 是 RP 模式下世界推进的最小单位。本目录定义 rp.leader、simulator.leader、simulator.actor、rp.writer 四个 profile 在一次 Tick 中的完整交互协议。数据层面的 simulation 目录结构和文件合同见 [simulation.md](../../content/simulation.md)。

## 文件索引

| 文件 | 内容 | 可被 Import 的 Profile |
|------|------|----------------------|
| [lod-simulation.md](lod-simulation.md) | LOD 世界模拟系统 | simulator.leader |
| [actor-facing-packet.md](actor-facing-packet.md) | Actor-facing packet 标签规范 | simulator.leader + simulator.actor |
| [writer-brief.md](writer-brief.md) | Writer Brief 剧本格式 | rp.leader + rp.writer |
| [tick-002-example.md](tick-002-example.md) | 完整 Tick 002 示例 | 不 Import，仅供参考 |

## Tick Lifecycle

一次完整的 Tick 经历以下 5 个阶段：

```
Phase 0        Phase 1         Phase 2            Phase 3          Phase 4         Phase 5
 IDLE ──────► rp.leader ──► simulator.leader ──► rp.leader ──► rp.writer ──► rp.leader ──► IDLE
              IC/OOC 审查     世界模拟 10 步        生成 Brief       无状态渲染       终稿组装
```

### Phase 1 — rp.leader：IC/OOC 审查

rp.leader 接收用户输入后执行以下判断：

- **IC/OOC 检查**：区分用户消息属于角色内（In-Character）行为还是元层（Out-Of-Character）指令。OOC 指令直接处理，不进入后续 Phase。
- **合理性校验**：评估 IC 行为在当前世界状态下是否合理，必要时向用户发出澄清或拒绝。
- **输出**：仅将需要世界响应的变化（world changes）发送给 simulator.leader，不传递渲染指令或叙事偏好。

### Phase 2 — simulator.leader：世界模拟

simulator.leader 执行 10 步工作流，驱动世界状态向前推进：

- 完整流程定义见 [lod-simulation.md](lod-simulation.md)。
- 与 simulator.actor 之间的数据包格式遵循 [actor-facing-packet.md](actor-facing-packet.md)。

### Phase 3 — rp.leader：生成 Writer Brief

rp.leader 根据 simulator.leader 返回的世界变化，组装一份 Writer Brief 剧本：

- Brief 格式定义见 [writer-brief.md](writer-brief.md)。

### Phase 4 — rp.writer：无状态渲染

rp.writer 是一个无状态渲染器（stateless renderer）：

- 仅依据收到的 Writer Brief 生成散文体叙事文本。
- 不持有世界状态，不做逻辑判断，不修改 Brief 中的事实。

### Phase 5 — rp.leader：终稿组装

rp.leader 接收 rp.writer 的渲染输出，完成最终组装：

- **Prose 组装**：校对叙事文本，确保与 Brief 事实一致。
- **Meta-scene 组装**：将本 Tick 产生的元数据（场景标签、状态变更摘要等）附加到输出，供下一次 Tick 的 Phase 1 消费。
