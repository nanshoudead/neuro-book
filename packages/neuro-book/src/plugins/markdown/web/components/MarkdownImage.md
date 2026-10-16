---
标签: []
别名: ["Markdown 图片", "Markdown Image"]
---

# MarkdownImage

Markdown 里一张图片 `![说明](地址)` 的样子：Markdown 编辑器的图片节点与展示器（[ui.markdown-display](../../../../../../../docs/specs/ui/markdown-display.md) 输出 4）都用它。地址换成可显示的 URL 由调用方给（`resolveAsset`），规则见 [workspace.markdown-dialect](../../../../../../../docs/specs/workspace/markdown-dialect.md) 输出 18。

## 布局与交互

- 行内显示，最宽不超过所在的版心，按比例缩小，不放大。
- **读取中**：一块淡色的占位，写着说明文字（没有说明写“图片”），高度与一行字相同。
- **显示**：图片本身；悬停提示是标题，没有标题时是说明。点击发出 `activate`。
- **不显示**：调用方给不出 URL（没有 `resolveAsset`、地址在作品根以外、解析不了）时，一个带图片图标的行内说明：“{说明或地址}（不在作品里，不显示）”。
- **读不出**：URL 加载失败时，同样的行内说明，危险色：“{说明或地址} 读不出”。
- 只用主题 token；390px 窄屏下图片随版心缩小。

## 数据

```ts
interface MarkdownImageProps {
    /** 必填：原文里写的地址。 */
    src: string;
    /** 界面语言。必填。 */
    locale: DisplayLocale;
    /** 说明；默认空字符串。 */
    alt?: string;
    /** 标题；默认 null。 */
    title?: string | null;
    /** 地址 → 可显示的 URL；返回 null 表示不显示。取消（`signal`）后迟到的结果由组件释放。默认没有。 */
    resolveAsset?: (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;
    /** 每变一次重新取一次 URL（文件在磁盘上变了）。默认 0。 */
    refresh?: number;
}

interface MarkdownImageEmits {
    (e: "activate"): void;
}
```

没有 slot 与 expose。根元素带 `data-markdown-image`，状态写在 `data-state`（`loading`、`shown`、`none`、`failed`）。

## 注意事项

- **释放**：`resolveAsset` 给出的 `release` 在地址或 `refresh` 变了、卸载时各调用一次；取消之后才到的结果立即释放，不显示。
- 编辑器与展示器是普通 DOM（节点视图、静态视图），用 Vue 的 `render()` 把它挂进各自的容器，卸载时 `render(null, 容器)`。
