---
标签: ["state:local"]
---

# 人物卡头部的候选身份

人物卡头部、称呼下面：这个对象有待确认的候选身份时显示一块（docs/specs/story/viewer.md 输出 59）：那句说法、章与来源、依据原文一句、“确认是同一人”与“不是”、一行说明“确认后从第 N 章第 M 段起生效，读到它之前仍看不到”。确认或驳回后这一块消失（数据版本变了，列表重取），页面下方出一条带“撤销”的提示。

## 数据

```ts
defineProps<{
    /** 人物卡的对象编号。必填。 */
    entity: string;
}>();
```

没有 emits、slots、expose。

## 隐藏通道理由

`state:local`：无；取数与写入经 `useStoryQuery` 与 `useRevise`（读 `useBook()` 与注入的客户端）。

## 注意事项

只列待确认的（`state: pending`）；对不上的、已处理的在待确认页。
