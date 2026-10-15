---
标签: ["state:local"]
---

# 分页长列表

成百上千条的列表（名册、知情记录、说法、悬念、情节、搜索结果）都用它：只画已经取到的条目，滚到末尾附近时发 `more` 要下一页，取数与分页由宿主做（docs/specs/story/viewer.md 输出 18）。首屏只取一页，所以上千条也能在 1 秒内显示首屏。

## 布局

一列，条目的样子由 `item` 插槽决定；末尾依次是错误（带“重试”）、“正在取……”或空列表的提示，最后是一个 1px 的哨兵元素。列表本身不滚，滚动的是外面的容器；哨兵进入可视区下方 400px 内就要下一页。

## 数据

```ts
defineProps<{
    /** 已取到的条目，按顺序。受控。 */
    items: readonly T[];
    /** 总条数；还不知道时为 null。 */
    total: number | null;
    loading: boolean;
    /** 还有下一页。 */
    hasMore: boolean;
    /** 出错时的说明；没有错误为 null。 */
    error: string | null;
    /** 空列表时的文字，缺省“没有记录”。 */
    emptyText?: string;
}>();
defineEmits<{
    /** 需要下一页：哨兵靠近可视区、且 hasMore 且不在取。 */
    more: [];
    /** 点了错误后的“重试”。 */
    retry: [];
}>();
defineSlots<{item(props: {item: T; index: number}): unknown}>();
```

没有 expose；attrs 透传到外层。

## 状态

`state:local`：持有哨兵元素与 IntersectionObserver，组件卸载时断开。

## 注意事项

- 一页没填满视口时，取完一页会再检查一次哨兵位置，必要时接着要下一页。
- 不做虚拟滚动：已取到的条目全部渲染。上千条全部滚完时 DOM 较大，但只有滚到底才会这样。
