---
标签: [state:local, state:inject]
别名: ["工具步骤行"]
验证入口: AgentTurnBlock
---

# AgentToolStepRow

思维链里一次以“一行”呈现的工具调用：图标、动作名、摘要与状态，改文件的单文件调用带增删行数（多文件的补丁不在行内统计）。点开是 `AgentToolDetail`。工具组里的一项、组收起时单独露出的出错项、思维链顶层的一行共用它，三处的样子因此一致。

## 数据

```ts
type AgentToolStepRowProps = {
    step: ToolStep;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
};

type AgentToolStepRowEmits = {
    /** 详情里宿主组件发出的 action，原样往上交。 */
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

- `state:local`：这一行是否展开。
- `state:inject`：经 `useAgentText()` 取语言与界面文字。
