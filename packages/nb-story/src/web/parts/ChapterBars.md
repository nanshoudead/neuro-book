---
标签: []
---

# 逐章记录量

说明与统计页的第一张图（docs/specs/story/viewer.md 输出 17）：每章一根柱，按说法、知情、情节、数值四类堆起来（`omit` 可以去掉其中几类），看得出哪几章信息密。横轴是全书的章数，阅读位置之后画一块浅色的“未读”区，柱只画到阅读位置所在章。悬停一根柱写出这一章各类的条数，点一根柱发出这一章（页面据此打开原文）。图区是固定高 140 像素、横向随容器拉伸的 SVG，坐标轴上的字用 HTML 写在图外，不随拉伸变形；颜色取主题的状态色。

## 数据

```ts
defineProps<{
    /** 第 1 章到阅读位置所在章，各章的条数（book.stats 的 chapters）。必填。 */
    rows: readonly {chapter: number; statements: number; knowledge: number; episodes: number; ledger: number}[];
    /** 全书章数，决定横轴。必填。 */
    total: number;
    /** 不画的类（例如书关掉了数值时的 "ledger"）：柱、悬停文字与图例里都没有它，其余各类颜色不变。默认都画。 */
    omit?: readonly ("statements" | "knowledge" | "episodes" | "ledger")[];
}>();
defineEmits<{
    /** 点了一章。 */
    select: [chapter: number];
}>();
```

没有 slots、expose；attrs 透传到根元素。
