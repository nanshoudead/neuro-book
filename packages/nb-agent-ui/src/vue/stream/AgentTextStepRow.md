---
标签: [state:inject]
别名: ["文字步骤行"]
验证入口: AgentTurnBlock
---

# AgentTextStepRow

思维链里一段文字步骤：思考或系统提示词。收起时一行写标签和正文第一行，第一行经 `renderers.markdownPreview` 去掉 Markdown 标记（宿主没给时用核心的 `markdownPreviewLine`）；点开在下方显示 Markdown 全文（淡色小字），行内不再重复第一行。正文为空时不能点开。

## 数据

```ts
type AgentTextStepRowProps = {
    icon: string;
    /** 例如“思考”，或系统提示词的标签。 */
    label: string;
    text: string;
    /** 取 resolveMarkdownAsset 换算 Markdown 里的图片。 */
    services: AgentConversationServices;
    /** 是否展开，必填；由使用方按步骤 id 记（思维链重新分组时这一行会换实例）。 */
    expanded: boolean;
};

type AgentTextStepRowEmits = {
    (e: "action", action: ViewAction): void;
    /** 点了这一行，携带期望的新状态。 */
    (e: "update:expanded", expanded: boolean): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

- `state:inject`：经 `useAgentText()` 取语言与界面文字，经 `useAgentRenderers()` 取 `markdownPreview` 与 Markdown 显示。
