---
标签: []
---

# 次要折叠条

列表顶部的一行蓝字：收起时写“展开次要（N）”，展开时写“收起次要（N）”（docs/specs/story/viewer.md 输出 9、56）。人物页的“其他”对象与人物卡“关于他的”说法共用，说法与样子一致。

## 数据

```ts
defineProps<{
    /** 次要的条数；不知道时为 null，不写括号。 */
    count: number | null;
    /** 是否展开。 */
    open: boolean;
}>();
defineEmits<{"update:open": [value: boolean]}>();
```

没有 slots、expose；根元素是带 `aria-expanded` 的按钮，attrs 透传（调用方用来加 `data-testid` 与外边距）。
