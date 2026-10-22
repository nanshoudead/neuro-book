---
标签: [state:local, state:inject]
别名: ["思维链块"]
验证入口: AgentTurnBlock
---

# AgentChainBlock

`AgentTurnBlock` 里思维链那一种块：一行摘要（`AgentChainSummary`），默认折叠；开头图标有思考时是大脑、否则是扳手，概括如“思考 · 读了 2 个文件，改了 1 个 · 另有 1 次操作”。展开后步骤挂在从图标垂下的竖线上：

- 工具组：一行合并摘要，点开逐项；组收起时出错的项单独露出。
- 一行呈现的工具：`AgentToolStepRow`；卡片呈现的工具：可展开卡片，内容是 `AgentToolDetail`。
- 并入的中间 content：Markdown 浅底小气泡，正文色。
- 思考与系统提示词：`AgentTextStepRow`。
- 两条 assistant 消息之间一道短虚线。

运行中摘要行的图标换成转圈，概括换成正在执行的那一步；是这一轮最后一块时，即使没有工具在跑也转圈。

## 数据

```ts
type AgentChainBlockProps = {
    chain: ChainBlock;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    /** 所在轮次的状态；决定卡片显示“运行中”还是“等待”。 */
    turnStatus: TurnStatus;
    /** 是否本轮最后一个块。 */
    last: boolean;
    /** 运行中逐步展开：思维链与工具组默认展开，用户点过的以用户为准；卡片与思考仍折叠。 */
    live: boolean;
};

type AgentChainBlockEmits = {
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。

## 隐藏通道理由

- `state:local`：思维链、工具组、卡片与各步骤行的展开状态，按 id 记（`useOpenSet`），思维链重新分组时不丢，随块挂载与卸载。
- `state:inject`：经 `useAgentText()` 取语言与界面文字。
