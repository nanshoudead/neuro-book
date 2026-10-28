---
标签: ["state:inject"]
---

# 依据原文

一条修订的依据：可点的出处（点开在抽屉里看原文）加那一段原文（已由服务端截短）。待确认页的卡片与人物卡的候选块共用。

## 数据

```ts
defineProps<{
    /** 出处“章.段”。必填。 */
    refText: string;
    /** 原文。必填；空串时不显示。 */
    text: string;
}>();
```

没有 emits、slots、expose。

## 隐藏通道理由

`state:inject`：出处链接 `RefLink` 经 `useBook()` 在抽屉里打开原文。
