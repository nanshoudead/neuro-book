---
标签: ["state:local"]
---

# 一项修订的卡片

待确认页与已处理页的一项（docs/specs/story/viewer.md 输出 58）：来源徽标、一句话、要做的事、依据原文（带可点的出处）和按钮。待确认的候选有“确认是同一人”“驳回”；对不上的（stale）只有“丢弃”；已确认、已驳回、用户自己的修订有“撤销”；后文已确认的没有按钮。

## 数据

```ts
defineProps<{
    /** `revisions.list` 的一项。必填。 */
    item: RevisionItem;
    /** 请求在途时禁用按钮。缺省 false。 */
    busy?: boolean;
    /** 高亮（抽屉里正在看它的对象）。缺省 false。 */
    highlighted?: boolean;
}>();
defineEmits<{
    confirm: [item: RevisionItem];
    reject: [item: RevisionItem];
    /** 撤销与丢弃共用。 */
    undo: [item: RevisionItem];
    /** 点卡片本身：页面打开相关对象的人物卡。 */
    open: [item: RevisionItem];
}>();
```

## 隐藏通道理由

`state:local`：无。组件只显示与发事件，写入由页面做；出处链接经 `RefLink` 读 `useBook()`。

## 注意事项

按钮点击不冒泡成“打开”。
