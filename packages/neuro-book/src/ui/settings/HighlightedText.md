---
标签: []
别名: ["命中高亮", "Highlighted Text"]
---

# HighlightedText

设置搜索结果里的一段文字（[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 21）：把搜索词在文字里命中的部分用 `<mark>` 标上底色，其余原样显示。它按片段渲染，不拼 HTML 字符串，所以文字里的 `<`、`&` 与正则元字符都按字面处理；根是一个行内的 `<span>`，里面是一串文本与 `<mark>`，放进标题、说明、组标题里就像直接写的字，文本总值不变。

## 布局

行内、没有自己的外观：一个 `<span>` 包着相邻的文本节点与 `<mark>`。命中片段的底色是强调色的淡一层，圆角取控件圆角的一半（行内文字上不宜太圆），文字色继承。

## 数据

```ts
type Props = {
    /** 要显示的文字；必填。空串什么也不画。 */
    text: string;
    /** 要标出的词（小写）；缺省与空数组一样，原样显示。 */
    words?: ReadonlyArray<string>;
};
```

没有 emits、slots、expose；attrs 落在根 `<span>` 上。命中片段带 `data-settings-hit`。

## 状态

不分大小写；每个词的所有命中都标；词互相重叠时较长的优先；没有命中时只有一段普通文字。
