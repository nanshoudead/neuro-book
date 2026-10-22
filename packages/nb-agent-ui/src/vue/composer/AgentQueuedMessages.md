---
标签: [state:inject]
别名: ["排队消息", "Queued Messages"]
---

# AgentQueuedMessages

运行中用户追加、还没有交给 Agent 的消息：补充说明（steer）在当前这一步结束后插入，排队（followup）在这一轮结束后发送。每条一行，标签加正文第一行，让用户知道刚才按下的回车没有丢。显示在输入框上方；待处理区（S7）做好后作为它的内置条目。

## 布局与交互

- 每条一行：左侧小标签（补充说明用回车箭头图标，排队用列表图标），后面是正文第一行，淡色，过长截断，悬停提示给出全文。
- 多条时按顺序排列，最多显示 3 条，更多的收成一行“还有 N 条”。
- 只显示，没有操作。

## 数据

```ts
interface AgentQueuedMessagesProps {
    /** 必填；为空时不渲染任何内容。 */
    queued: ReadonlyArray<{id: string; text: string; delivery: "steer" | "followup"}>;
}
```

没有事件、插槽与 expose。未声明的 attribute 落到根元素上。
