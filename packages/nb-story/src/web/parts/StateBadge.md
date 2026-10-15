---
标签: []
---

# 知情状态徽标

秘密矩阵、人物卡与知情记录里的一格状态：知道、读到、认为、听说、怀疑、不知道、没有记录。“没有记录”画成描边、不带颜色，和明确写了“不知道”的红色分开（docs/specs/story/viewer.md 输出 11：没有记录不等于不知道）。

## 数据

```ts
defineProps<{
    /** 知情状态，取查询结果里的 Awareness。必填。 */
    state: "knows" | "read" | "believes" | "heard" | "suspects" | "unaware" | "no-record";
}>();
```

没有 emits、slots、expose；根元素带 `data-state`，attrs 透传。
