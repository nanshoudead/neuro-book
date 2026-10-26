---
标签: []
---

# 悬念累计曲线

说明与统计页的第三张图（docs/specs/story/viewer.md 输出 17）：逐章累计的“提出”与“解答”两条线，两线之间涂浅色，就是当时还没解开的悬念。横轴是全书章数，线只画到阅读位置所在章。悬停一章写出累计提出、解答与没解开的条数；点一章发出这一章。图区是固定高 120 像素、横向随容器拉伸的 SVG，线宽不随拉伸变，坐标轴上的字用 HTML 写在图外。

## 数据

```ts
defineProps<{
    /** 第 1 章到阅读位置所在章，各章新提出与解答的悬念数（book.stats 的 chapters）。必填。 */
    rows: readonly {chapter: number; raised: number; answered: number}[];
    /** 全书章数。必填。 */
    total: number;
}>();
defineEmits<{
    /** 点了一章。 */
    select: [chapter: number];
}>();
```

没有 slots、expose；attrs 透传到根元素。
