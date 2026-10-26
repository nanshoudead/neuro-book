---
标签: []
---

# HighlightText

搜索结果里的一段文字（t15 阶段 4 第 5 批）：搜索词不分大小写地用 `<mark class="nbdev-mark">` 标出，其余照原样。切段在 `host/highlight.ts`，文字按插值渲染，不用 `v-html`。

## 数据

```ts
interface HighlightTextProps {
    /** 要显示的文字；必填 */
    text: string;
    /** 搜索词；必填，空白时不标 */
    q: string;
}
```

没有事件、插槽与 expose；没有根元素（多段文字直接放进父元素），截断、字体由父元素给。
