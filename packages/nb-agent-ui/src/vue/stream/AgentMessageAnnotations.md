---
标签: [state:inject]
别名: ["附注", "Message Annotations"]
验证入口: AgentConversationView
---

# AgentMessageAnnotations

一条助手消息上的附注：宿主挂在回复上的补充信息，例如问答回复里没核实的出处。附注跟着它所在的消息显示与收起，不占消息流里的位置，所以不会因为排在哪里而被收进过程或拉长用时。

## 显示

- 每条附注按 `customType` 找条目渲染器。登记了的由宿主组件画，组件收到 `ctx`、`services`、`locale`、这条附注 `annotation` 与它所在的消息 `message`，只发 `action`，视图原样交给宿主。
- 没有登记的，或宿主组件渲染时抛错的，画默认的一行：附注的 `text`，淡色小字。出错时另打一条开发诊断。
- 多条附注上下排列，间距小于段落。

## 位置

由使用方放：

- 最终回复：在回复气泡里、正文下方；
- 思维链里的中间 content：在那段文字下面，思维链展开时可见；
- 没有文字的助手消息：作为单独的一块排在这条消息之后，分轮时与信息条目同样对待。

## 数据

```ts
props: {message: AssistantMessageView; ctx: AgentConversationContext; services: AgentConversationServices; registry: AgentViewRegistry}
emits: {action: ViewAction}
```

语言经 `useAgentText` 注入，所以标签含 `state:inject`。
