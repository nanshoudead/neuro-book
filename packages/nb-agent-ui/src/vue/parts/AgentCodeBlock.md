---
标签: [state:inject]
别名: ["代码块（Agent）"]
验证入口: AgentConversationView
---

# AgentCodeBlock

nb-ui `CodeBlock` 的薄包装：带上本包界面文字里的“内容为空”与“只公开了部分内容”，按 `locale` 显示。工具详情（通用、文件内容、命令）与原始视图的 JSON 块都用它，免得每处各绑一遍两条文字。内部组件，经对话视图与各工具详情的场景验证。

## 数据

```ts
type AgentCodeBlockProps = {
    /** 代码行，必填；增删行用 `tone` 着色。 */
    lines: CodeLine[];
    /** 块顶的标题，例如文件路径；默认空。 */
    label?: string;
    /** 第一行的行号；null 时不显示行号。默认 null。 */
    startLine?: number | null;
    /** 内容只公开了一部分；为真时块底显示说明。默认 false。 */
    truncated?: boolean;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

- `state:inject`：经 `useAgentText()` 取宿主交出的语言，两条文字跟随它。
