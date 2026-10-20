---
标签: [env:timer]
---

# NotificationStack

`NotificationStack` 是一份通知队列的可视出口：把队列里的通知固定显示在视口边缘，并集中处理自动消失、悬停暂停、关闭和通知动作。它本身不创建通知；宿主挂一个视口，就能显示经该队列发出的通知。队列缺省是 `useNotification()` 的模块级队列；要隔离时（一个窗口一份、Lab 场景、测试）用 `createNotificationQueue()` 自建一份传给 `queue`。

## 布局

通知按创建顺序纵向排列，间隔 8px；每项由 `Notification` 渲染。固定容器最大宽度为 448px（含两侧各 16px 内边距），单条通知内容区最大约 416px。默认固定在视口底部水平居中，也可固定在右上或右下。通知不拦截空白处的指针事件，单条通知可交互。

在窄屏中仍使用所选边缘位置和居中规则，宽度受视口与外边距约束，内容超长由通知自身排版；进入和离开分别淡入淡出并沿纵向移动 8px。

## 交互

- 队列中的通知由队列自动移除；指针进入某条通知时暂停它的自动关闭计时，离开后按剩余时间恢复，且至少留出 800ms；暂停期间队列改了它的时长（`update`）也只记下新的到期时间，不会到点移除。
- 带动作的通知显示动作按钮。点击后调用该通知携带的 `action.run()`，随后移除该通知；`run` 抛错时同样移除，错误照常抛给 Vue 的错误处理。
- 不论通知是否有自动关闭时长，视口都将每条通知设为可关闭；点击“关闭通知”按钮后从队列移除该项。
- 带进度的通知显示进度条（`Notification` 的 `progress`），发出方经队列的 `update` 推进。
- 动作与关闭按钮的键盘、焦点和可访问名称由子组件 `Notification` 的按钮承担；本组件自身不注册快捷键。

## 数据

```ts
type NotificationPosition = "bottom-center" | "bottom-right" | "top-right";

interface NotificationStackProps {
    /** 通知堆叠位置；默认 "bottom-center"。 */
    position?: NotificationPosition;
    /** 每条通知关闭按钮的可访问名称与 title；默认 "关闭通知"。 */
    closeLabel?: string;
    /** 显示哪份队列；默认 `useNotification()` 的缺省队列。挂载时取定，之后换 prop 不生效，换队列应换一个视口实例。 */
    queue?: NotificationQueue;
}

interface NotificationStackEmits {}
interface NotificationStackSlots {}
```

没有 `update:*` 事件，通知列表不受控于 props；组件不 expose 方法或属性。根节点是一个固定定位的容器（`data-notification-stack`），未声明的 attrs 落在它上面。

## 状态与边界

- 空队列：容器内没有通知。
- 有通知：按队列顺序堆叠；通知的 tone、标题、消息、动作、进度和时长来自队列里的 `NotificationItem`。
- 视口强制每条通知 `dismissible: true`，所以视口中总有关闭按钮。
- 本组件没有禁用、只读、加载或错误状态。

## 不支持

- 不提供创建、更新或清空通知的 props、slots、emits 或 expose API；这些动作由队列（`NotificationQueue`）提供。
- 不提供逐条可配置的停留时长或动作确认流程；时长及动作函数随通知数据一起提交。

## 隐藏通道理由

`env:timer`：自动关闭计时器由队列管理，视口在悬停时暂停、离开时恢复该计时器。计时与通知队列生命周期相同，集中在队列里处理。
