---
标签: []
别名: ["纯文字 Markdown", "Plain Markdown"]
---

# PlainMarkdown

宿主没有注入 Markdown 显示组件时，对话视图用它显示回复：原文按纯文字显示，保留换行，不解析 Markdown，没有可点击的引用、链接与图片。

## 数据

```ts
type PlainMarkdownProps = {
    /** 原文，必填。 */
    text: string;
    /** 界面语言，必填；与真组件同形，这里不用。 */
    locale: "zh-CN" | "en-US";
    /** 正在流式生成；只写到根节点的 data-streaming。 */
    streaming?: boolean;
    /** 图片地址换算；与真组件同形，这里不用。 */
    resolveAsset?: (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;
};
```

没有 emits、插槽和 expose。
