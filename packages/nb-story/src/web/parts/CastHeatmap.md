---
标签: []
---

# 人物出场热力格

说明与统计页的第二张图（docs/specs/story/viewer.md 输出 17）：一行一个主要人物，一格一章，颜色越深表示这一章里他被提到得越多（按开方映射，免得少数高峰把其余格子压成看不见）。横轴是全书的章数，阅读位置之后的格子画成浅底、不可点。悬停写出人名、章与次数；点格子发出这一章，点名字打开人物卡。格子不进 Tab 顺序（上千个停靠点没法用），键盘用户从原文页的目录选章。用 CSS grid 画，随容器宽度伸缩。

## 数据

```ts
defineProps<{
    /** 主要人物与逐章出场次数（book.stats 的 cast）；counts 的长度是阅读位置所在章。必填。 */
    cast: readonly {id: string; label: string; counts: readonly number[]}[];
    /** 全书章数。必填。 */
    total: number;
}>();
defineEmits<{
    /** 点了一格，带章号。 */
    select: [chapter: number];
}>();
```

没有 slots、expose；attrs 透传到根元素。名字用 `NameLink`，要放在书的外壳里。
