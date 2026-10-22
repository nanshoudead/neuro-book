---
标签: [state:inject]
别名: ["Markdown 正文", "回复正文"]
---

# Agent Markdown 正文

对话视图里 Agent 回复正文、过程中的说明文字、思考全文与系统条目的正文。渲染与净化交给宿主注入的 Markdown 显示组件（形状见核心 `ports.ts` 的 `MarkdownDisplayPortProps`，neuro-book 注入 `nbook.markdown` 的 `MarkdownDisplay`）；没有注入时用包内的 `PlainMarkdown` 按纯文字显示，不插入任何 HTML。

## 布局

正文颜色与字号由所在位置用 `--nb-agent-markdown-color`、`--nb-agent-markdown-size` 调整（缺省正文色、`--text-sm`），思考与提醒用它显示为淡色小字；字号同时交给注入组件的 `--markdown-font-size`。块间距、行高、列表与代码块的样子由注入的组件决定。

## 交互

注入的组件拦下点击、只发出 `activate`，这里换成对话视图的动作（docs/specs/ui/agent-conversation-view.md“消息”）：

- 引用：发出 `action`，`{type: "reference.open", target}`；
- 外链：发出 `action`，`{type: "link.open", href}`，由宿主决定怎么打开；
- 图片：发出 `image.preview` 的 action（`{markdownSrc, name}`），对话视图经 `services.resolveMarkdownAsset` 换算地址后打开原图预览。

## 数据

```ts
type AgentMarkdownProps = {
    /** Markdown 原文，必填。 */
    text: string;
    /** 图片地址换算，交给注入的组件；不提供时图片只显示说明。 */
    resolveAsset?: MarkdownAssetResolver;
    /** 正在流式生成；交给注入的组件显示光标。默认 false。 */
    streaming?: boolean;
};

type AgentMarkdownEmits = {
    /** 用户意图，原样交给对话视图；原图预览是其中的 `image.preview`，由对话视图自己打开，不到宿主。 */
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。语言与渲染组件经 `provideAgentView` 注入。
