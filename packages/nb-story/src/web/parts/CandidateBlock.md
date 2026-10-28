---
标签: ["state:inject", "io:read", "io:mutate"]
---

# 人物卡头部的候选身份

人物卡头部、称呼下面：这个对象有待确认的候选身份时显示一块（docs/specs/story/viewer.md 输出 59）：那句说法、来源、涉及的对象（可点）、依据原文一句、“确认是同一人”与“不是”、一行说明“确认后从第 N 章第 M 段起生效，读到它之前仍看不到”。从待确认页点开这个人物卡时，那一条候选带外框高亮。确认或驳回后这一块消失（数据版本变了，列表重取），人物卡里出一条带“撤销”的提示。最多列 5 条，多的写“还有 N 条”并去待确认页看。

## 数据

```ts
defineProps<{
    /** 人物卡的对象编号。必填。 */
    entity: string;
}>();
```

没有 emits、slots、expose。

## 隐藏通道理由

- `state:inject`：经 `useBook()` 读阅读位置、跳到待确认页；名字与出处链接（`NameLink`、`RefLink`）经它打开抽屉。
- `io:read`：取这个对象待确认的候选（`revisions.list` 带 `entity`）。候选的取数随阅读位置与数据版本变，放在宿主（DrawerCard）里要多传一份列表与刷新，由它自己取更近。
- `io:mutate`：确认、驳回、撤销（`revisions.confirm`、`revisions.reject`、`revisions.undo`）；写入与反馈（忙、错误、撤销提示）是一件事，由 `useRevise` 统一。

## 注意事项

只列待确认的（`state: pending`）；对不上的、已处理的在待确认页。
