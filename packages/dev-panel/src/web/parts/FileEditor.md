---
标签: ["state:local"]
---

# FileEditor

编辑页的 Markdown 编辑器（t10）：组合 nb-ui 的 `Textarea`、`SegmentedControl` 与本包的 `MarkdownView`，在编辑与预览之间切换；不改 nb-ui、不加编辑器依赖（决定点 5）。根级治理入口（`AGENTS.md`、`WATCHDOG.md` 等）另显示非空行数与治理检查的上限，超了标红。

## 数据

```ts
interface FileEditorProps {
    /** 文本；必填、受控 */
    modelValue: string;
    /** 当前文本的预览 HTML（页面经 host/markdown.ts 渲染）；必填 */
    previewHtml: string;
    /** 只读（不能编辑时；保存在途时宿主也置只读，t15）；必填 */
    readonly: boolean;
    /** 治理检查的非空行上限；不是治理入口时为 null；必填 */
    lineLimit: number | null;
}
interface FileEditorEmits {
    (event: "update:modelValue", value: string): void;
    /** 预览里点了站内链接 */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。非空行的数法与治理检查相同（核心的 `countNonEmptyLines`）。
