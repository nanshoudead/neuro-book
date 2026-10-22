---
标签: [state:inject]
别名: ["工具详情", "Tool Detail"]
---

# Agent 工具详情

思维链里一次工具调用展开后的内容。它按工具名向注册表查渲染器：渲染器登记了 `detail` 组件（常用工具的适配）时用它；没有组件而给了 `diff` 时画成一段 diff，标题是渲染器的单行摘要；都没有、或 `diff` 这次给不出（返回 null）时显示底层原始数据，开发者据此对照调用：

- “参数 · 工具名”：参数的 JSON，两空格缩进。
- “结果”：结果正文；只公开了预览时末尾提示。
- “结构化结果”：结果带 `details` 时显示它的 JSON。
- 还没有结果时一行淡色“还没有结果”。

调用出错时，错误信息以危险色显示在最上方，下面照常显示适配内容或原始数据；有适配但出错且没有结果时（适配内容无东西可画），改为附上原始参数，方便看是什么参数导致的。

内置适配：`read` 用 `AgentFileContentDetail`（带行号的文件内容），`bash`、`execute_sql` 用 `AgentCommandDetail`（命令与输出）；`edit`、`write`、`apply_patch` 由登记项给出 `diff`。

## 数据

```ts
type AgentToolDetailProps = {
    /** 要展开的调用，必填。 */
    call: ToolCallView;
    /** 对话视图的 ctx，必填；原样传给适配组件。 */
    ctx: AgentConversationContext;
    /** 必填；原样传给适配组件。 */
    services: AgentConversationServices;
    /** 必填；按工具名查适配组件。 */
    registry: AgentViewRegistry;
};

type AgentToolDetailEmits = {
    /** 适配组件发出的 action，原样往上交。 */
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。适配组件是宿主组件，接收 `ToolComponentProps`（这次调用、ctx、服务与界面语言），只发 `action`。
