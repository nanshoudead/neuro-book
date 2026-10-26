---
标签: [state:shared-write, env:timer]
别名: ["通知视口"]
---

# WorkbenchNotifications

工作台两个内置页面根上的通知视口（[`workbench/notifications.md`](../../../../../../../docs/specs/workbench/notifications.md) 输出 2）：接工作台通知服务的队列，经 nb-ui 的 `NotificationStack` 显示在窗口右下角。没有自己的样式与交互，所有行为见 nb-ui 的 `NotificationStack`。

## 数据

```ts
type Props = {
    /** 本窗口的通知队列（`createNotifications().queue`）。 */
    queue: NotificationQueue;
};
```

没有事件、插槽与 expose；attrs 落到视口的根节点上。

## 隐藏通道理由

`state:shared-write`：它显示并改写本窗口共享的通知队列（关闭、点动作都从队列移除），Lab 不挂它；要看视口用 nb-ui `NotificationStack` 的场景（夹具自建队列）。

`env:timer`：队列的自动关闭计时在队列里，视口悬停时暂停它；本组件只是产品页面的接线。
