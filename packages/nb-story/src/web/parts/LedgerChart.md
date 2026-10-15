---
标签: []
---

# 余额阶梯线

一项数值的余额随章变化画成阶梯线（docs/specs/story/viewer.md 输出 12）：每一笔之后保持水平，到下一笔再跳到新余额。起始金额未知、余额是相对值的那几段画虚线；原文报数与累加对不上的那一笔画一个提醒色的点，悬停写出差额。纯 SVG，随容器宽度缩放。

## 数据

```ts
defineProps<{
    /** 按先后排好的各笔：发生在第几章、这笔之后的余额、是否相对值、与累加的差额（没有差额为 null）。必填。 */
    points: readonly {chapter: number; balance: number; relative: boolean; gap: number | null}[];
    /** 横轴画到第几章（阅读位置所在章）。必填。 */
    chapters: number;
}>();
```

没有 emits、slots、expose；attrs 透传到 `svg`。

## 状态

`points` 为空时只画坐标轴。
