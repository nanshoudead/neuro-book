---
标签: []
---

# 问答的 Markdown 显示

问答页注入对话视图的 `renderers.markdown`（docs/specs/story/viewer.md 的问答页）：先把正文里的出处“章.段”“章.段—章.段”改写成 `paragraph://` 链接（`link-refs.ts`），再交给 nb-markdown 的 `MarkdownDisplay`。出处显示成引用小块，点击经 `onActivate` 发 `{kind: "reference", target}`，对话视图把它转成 `reference.open`。

## 数据

```ts
defineProps<MarkdownDisplayPortProps>();   // text、locale、streaming、resolveAsset、onActivate
```

属性原样转给 `MarkdownDisplay`，只换 `text`。与端口的对照在 `ports.typecheck.ts`。

## 注意事项

- 代码、行内代码、已有链接与图片、裸网址、HTML 里的“章.段”不改（按同一份方言的词法器判断）。
- 流式时文末的出处可能还没写完，先不改，写完的下一帧再改。
