---
标签: []
---

# 原文段落

把一段原文画出来，里面程序找到的称呼带淡底色、可点开人物卡（docs/specs/story/viewer.md 输出 16、19）。称呼的位置（`start`、`end`）来自查询结果；哪些称呼能标由查询按阅读位置决定，这里不另行匹配名字。

## 数据

```ts
defineProps<{
    /** 原文。必填。 */
    text: string;
    /** 这一段里可标的称呼：所属的点 id、写法与在原文里的位置（左闭右开）。必填，可以为空。 */
    names: readonly {entity: string; text: string; start: number; end: number}[];
}>();
```

没有 emits、slots、expose；attrs 透传到外层 `span`。

## 注意事项

- 位置越界、与原文对不上或与前一个称呼重叠的称呼不标，原文照常完整显示。
- 称呼用 NameLink 渲染，所以要放在书的外壳里（NameLink 经注入打开人物卡）。
