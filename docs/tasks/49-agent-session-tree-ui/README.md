# Agent Session Tree UI Refactor

## Relative documents refs

- [Agent Session Management](../15-agent-session-management/README.md)
- [Agent SSE Front-End Contract](../14-agent-sse-front-end-contract/README.md)
- [Agent Sidecar Profile Pass](../23-agent-sidecar-profile-pass/README.md)
- [AgentSessionTreeDialog.vue](../../../app/components/novel-ide/agent/AgentSessionTreeDialog.vue)
- [session-tree.ts](../../../app/components/novel-ide/agent/session-tree.ts)

## User Request / Topic

- Session Tree dialog 当前树线和缩进语义不对。
- 之前的补丁仍然把 session parent 链当成 UI 树深度，导致线性历史也持续右移。
- 用户明确要求：
  - 分支节点不能被收起或过滤到不可理解。
  - 只有真的出现分支时，才分支缩进一节。
  - 需要重构这方面，而不是继续局部修补。

## Goal

重构 Agent Session Tree 的前端展示模型，让 UI 表达的是“会话 continuation / branch 关系”，而不是原始 entry parent 链深度。

成功标准：

- 线性 session 历史在视觉上保持同一主线，不会每条 parent-child 都右移一格。
- 只有同一个可见 branch point 下存在多个可见 continuation 时，才产生分支缩进。
- branch point 本身必须可见，用来解释后续分支从哪里展开。
- sidecar 分支、retry 分支、手动 tree move 产生的分支都能在 Session Tree 中审计。
- 消息气泡上的 swipe / branch switcher 与 Session Tree dialog 使用同一套 branch projection 语义。
- 有可运行的单元测试覆盖线性链、普通分支、嵌套分支、sidecar 分支和过滤模式。

Blocked stop condition：

- 已前置确认：现有 `SessionTreeNode` DTO 足够支撑 V1 projection。
  - `childCount > 1` 可以判断原始 branch point。
  - `parentId` 链可以追溯 lane 和 branch anchor。
  - 不需要新增后端字段，blocked stop condition 默认不会触发。
- 如果实现过程中发现仅靠 `childCount` / `parentId` 无法稳定区分某类真实分支，停止实现并报告具体反例，不用 UI hack 猜测。

## Current State

- `AgentSessionTreeDialog.vue` 直接基于 `deriveAgentTreeState(...).flattenedNodes` 渲染。
- 当前缩进尝试在组件内基于 parent 链、可见 parent 链或 sibling 数量临时计算，语义不稳定。
- `session-tree.ts` 目前主要服务消息级 branch switcher：
  - `deriveSwitcherByMessageId()` 只看 active message 节点的同 role sibling。
  - `resolveBranchSwitchTarget()` 取 sibling 的 latest terminal。
- Dialog 的树线和 message swipe 是两套相关但未统一的推导逻辑。
- 过滤模式会隐藏部分节点，导致原始 parent 链断裂；如果不先建立“可见树投影”，UI 线条必然错。

## Decisions / Discussion

### 1. UI Tree 不是原始 Parent Chain

原始 session entry parent 链表示 append-only 历史和 active leaf 回溯，不等于 UI 缩进层级。

UI 需要表达：

- linear continuation：普通下一条消息或工具结果，仍在当前 lane。
- branch point：同一个 parent 下有多个 continuation 选择。
- branch lane：从 branch point 分出的某条 continuation。

因此：

```text
A -> B -> C -> D
```

所有节点同一层。

```text
A -> B
     |-> C1 -> D1
     `-> C2 -> D2
```

只有 `C1/C2` 所在 continuation lane 缩进一节，`D1/D2` 不继续额外缩进。

嵌套分支才继续增加一节：

```text
A -> B
     |-> C1 -> D1
     |        |-> E1
     |        `-> E2
     `-> C2 -> D2
```

### 2. Branch Point 不能被收起

V1 不做折叠/展开功能。所谓“不能收起”在本 task 中解释为：

- 默认过滤不能把真实 branch point 隐藏到用户无法理解分支来源。
- 如果过滤模式隐藏了某些普通工具节点，也必须保留解释当前可见分支所需的最近 branch point。
- Search 可以缩小结果，但需要保留匹配节点的可见祖先/branch anchor，避免孤立节点悬空。

### 3. 先做 Projection，再做 UI

需要新增或重构一个纯函数，例如：

```ts
type AgentSessionTreeRow = {
    node: SessionTreeNode;
    visibleParentId: string | null;
    /** 节点所在 lane 的深度，不是原始树递归深度。线性子节点继承父 lane，例如 D1 与 C1 同 depth。 */
    laneDepth: number;
    isBranchPoint: boolean;
    branchSiblingCount: number;
    branchIndex: number | null;
    guideParts: TreeGuidePart[];
};

function deriveAgentSessionTreeRows(input: {
    tree: SessionTreeNode[];
    filterMode: AgentSessionTreeFilterMode;
    query: string;
}): AgentSessionTreeRow[];
```

`AgentSessionTreeDialog.vue` 只消费 rows，不在模板中临时计算 parent、depth 和 guide。

注意：

- `active` / `terminal` 不放进 row，调用方直接读 `row.node.active` / `row.node.terminal`，避免 DTO 状态重复。
- `AgentSessionTreeFilterMode` 和 `TreeGuidePart` 都应定义在 `session-tree.ts`，不要让纯 projection 函数反向依赖 Vue 组件。

### 4. Filter 语义

初始过滤模式建议：

- `Default`：显示对话主干、system/custom 注入、branch point、sidecar enter、summary 和错误。
- `No-tools`：隐藏纯工具结果和 tool-only assistant，但保留必要 branch point。
- `User`：显示 user/custom user，同时保留必要 branch point。
- `Labeled`：显示 label / branch summary / 手动标记节点，同时保留必要 branch point。
- `All`：显示所有非 leaf / 非 projection 节点。

过滤后必须再次做 branch projection，不能复用未过滤树的 depth。

`isBranchPoint` 和 `branch_summary` 必须区分：

- `branch_summary` 是原始 entry type，用于展示摘要节点。
- `isBranchPoint` 是 projection 计算出来的结构属性，表示此节点是当前可见 tree 的分叉锚点。
- 两者不能混用，也不能因为某个节点是 `branch_summary` 就当成分叉锚点。

Search 是过滤的一种特殊情况。搜索命中深层节点时，结果必须补齐必要 branch anchor：

```text
A -> B
     |-> C1 -> D1 -> E1
     `-> C2 -> D2
```

搜索匹配 `E1` 时，结果至少保留 `B` 和 `C1`，让用户知道 `E1` 属于哪个分支；`C2` / `D2` 不应仅因为同属 `B` 的其他分支而出现。

### 5. Sidecar 可观测性

Sidecar transcript 是 inactive branch，也应该在 tree dialog 中清楚出现。

要求：

- `sidecar: actor.context-load` / `sidecar: actor.memory-save` enter message 可以作为 sidecar branch 起点显示。
- 如果 sidecar branch 和 lifecycle end 是 sibling，UI 仍能显示它们是同一个 parent 下的两个 continuation。
- 普通聊天流不必展示 sidecar transcript，但 Session Tree dialog 必须能审计。

## Verification / Test

新增或调整测试：

- `session-tree.ts` projection test：
  - 线性链 `A -> B -> C -> D`：所有 row `laneDepth = 0`。
  - 单分支 `B -> C1/C2`：`C1/C2` 的 `laneDepth = 1`，`D1/D2` 继续保持 `1`。
  - 嵌套分支：嵌套 continuation 才进入 `laneDepth = 2`。
  - 过滤隐藏工具节点时，branch point 仍保留。
  - search 命中深层节点时，必要 branch anchor 仍保留：搜索匹配 `E1`，`B` 与 `C1` 必须出现，`C2` / `D2` 不出现。
  - sidecar enter message 与 lifecycle end sibling 能形成可见 branch group。
- 现有测试继续通过：
  - `bun run test app/components/novel-ide/agent/session-tree.test.ts`
  - `bun run test app/components/novel-ide/agent/useAgentSession.test.ts`

可选人工验证：

- 打开用户提供的 session，检查 Session Tree dialog：
  - 长线主干不再阶梯式右移。
  - 只有 retry / sidecar / tree move 分叉处出现缩进。
  - `actor.memory-save` sidecar 分支可在 tree 中找到。

## Implementation Walkthrough

- 2026-06-13：创建 task。先冻结需求，不继续修当前模板树线。
- 2026-06-13：补充 DTO 充分性、`laneDepth` 语义、`AgentSessionTreeFilterMode` / `TreeGuidePart` 类型归属、search + branch anchor 测试用例，以及 `branch_summary` 与 `isBranchPoint` 的边界。
- 2026-06-13：新增 `deriveAgentSessionTreeRows()` projection：
  - `AgentSessionTreeRow` 不重复 `active` / `terminal`，调用方直接读 `row.node.active` / `row.node.terminal`。
  - `laneDepth` 表示 lane 深度，不是原始 tree depth；线性 continuation 不额外缩进。
  - branch guide parts 由 projection 统一生成，分支 lane 内的线性后续节点会保留持续线，不再由 Vue 模板临时推导。
- 2026-06-13：重写 `AgentSessionTreeDialog.vue` 列表渲染，只消费 projection rows；Dialog 不再维护本地 `filteredTree`、parent-chain depth 或树线计算。
- 2026-06-13：验证：
  - `bun run test app/components/novel-ide/agent/session-tree.test.ts app/components/novel-ide/agent/useAgentSession.test.ts` 通过，2 个 test files / 22 tests。
  - `bun run typecheck` 仍失败在既有无关错误：`agent-suggestion.test.ts`、`ProfileTemplateNodeView.vue`、`server/agent/harness/compaction.ts`、`report-result-schema.test.ts`、`silly-tavern-card-cli.test.ts`；没有出现本 task 修改文件相关错误。
- 2026-06-13：统一 message swipe branch switcher 与 Dialog 的 branch projection 语义：
  - `switcherByMessageId` 不再按“同 role message sibling”分组。
  - 每个 `childCount > 1` 的 raw branch point 下，直接 children 被视为 continuation lane roots。
  - active lane root 是可挂载到消息气泡的 `messageId` 时，气泡显示 swipe switcher；切换目标仍落到目标 lane root 的 latest terminal。
  - `nodeIds` 现在表示 continuation lane roots，不保证每个 root 都是 message 节点。
- 2026-06-13：补充 switcher 回归测试：不同 role 的 continuation lane roots 也能形成同一个 swipe group，验证旧的同 role 限制已移除。
- 2026-06-13：再次验证：
  - `bun run test app/components/novel-ide/agent/session-tree.test.ts app/components/novel-ide/agent/useAgentSession.test.ts` 通过，2 个 test files / 24 tests。
  - `bun run typecheck` 仍失败在同一批既有无关错误，没有出现本 task 修改文件相关错误。

## TODO / Follow-ups

- [x] 设计 `AgentSessionTreeRow` / `TreeGuidePart` 类型。
- [x] 将 `AgentSessionTreeFilterMode` 从 Vue 组件迁到 `session-tree.ts`，作为 projection 纯函数入参类型。
- [x] 将 `TreeGuidePart` 类型也迁到 `session-tree.ts`，避免 Dialog 自己定义树线协议。
- [x] 把 branch projection 逻辑从 `AgentSessionTreeDialog.vue` 移到 `session-tree.ts`。
- [x] 为 projection 写红灯测试，包含 search + branch anchor 的完整期望。
- [x] 重写 Dialog 列表渲染，只消费 projection rows。
- [x] 统一 message swipe branch switcher 与 dialog 的 branch projection 语义；此项依赖 Dialog projection rows 落地后再验证，避免两边并行改出不同 branch 语义。
- [x] 移除本轮临时树线补丁中容易误导的 parent-chain depth 逻辑。

## Follow-up Options

- Search 模式当前只展示命中路径和必要 branch anchor，不展示同一 branch point 下未命中的 sibling。这更适合搜索聚焦；如果希望搜索时也显示“这里还有其他分支”，需要增加 collapsed sibling hint，而不是把未命中的分支完整展开。
- V1 swipe switcher 挂在 active continuation lane root 对应的消息气泡上。如果 lane root 是 `toolResult` / lifecycle / 其他非文本气泡节点，聊天流不额外寻找后续 descendant 气泡承载外层分支 switcher；这类分支仍通过 Session Tree dialog 审计。后续如果需要，可以增加“最近可见消息 descendant 承载 switcher”的交互规则，但要处理嵌套分支 switcher 冲突。
