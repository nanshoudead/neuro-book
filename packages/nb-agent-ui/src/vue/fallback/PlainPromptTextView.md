---
标签: []
别名: ["纯文字消息", "Plain Prompt Text"]
---

# PlainPromptTextView

宿主没有注入已发送文字的显示组件时，对话视图用它显示用户消息：文字写法原样显示，保留换行；标签、附件与粘贴块不画成小块，也不能点。

## 数据

```ts
type PlainPromptTextViewProps = {
    /** 已发送的文字，必填。 */
    text: string;
    /** 界面语言，必填；与真组件同形，这里不用。 */
    locale: "zh-CN" | "en-US";
    /** 与真组件同形，这里不用。 */
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
};
```

没有 emits、插槽和 expose。
