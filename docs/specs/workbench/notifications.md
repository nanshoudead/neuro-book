---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.notifications
owners:
  - nbook.workbench
---

# 工作台通知

## 目标与非目标

给窗口里的插件一个统一的通知去处：一次操作的结果、后台的失败与长任务的进度，经工作台的通知服务发出，显示在窗口右下角；能当场改的输入留在表单里提示，整页或整视图不可用的原位阻断。本 Spec 定三个去处的分工、通知服务的合同、视口的位置与时长规则。

不承诺：

- 通知中心（翻历史）、活动栏角标、系统通知、标签页标题计数：以后另定。
- 持续存在的连接状态横幅：组件 `Banner` 已在 nb-ui，第一个使用者随浏览器宿主的断线重连另定。
- 跨窗口的通知：每个窗口一份队列，别的窗口看不到。

## 术语与参与者

- **去处**：一条提示该显示在哪：表单、通知、原位。判据是“用户能对它做什么”。
- **通知服务**：`nbook.workbench` 提供的服务 `nbook.workbench/notifications`（`notificationsKey`），插件在入口依赖里声明后经 `notify` 发出通知。
- **视口**：nb-ui 的 `NotificationStack`，挂在工作台两个内置页面的根上，显示本窗口的队列。
- 参与者：发出通知的插件（书架、编辑器、文件等）；工作台（队列、视口）；用户（关闭、点动作）。

## 输入与前置条件

- 服务合同（`nbook/plugins/workbench/shared/contracts`）：

  ```ts
  interface NotificationInput {
      tone?: "info" | "success" | "warning" | "error";   // 缺省 info
      title?: Text;
      message: Text;
      action?: {label: Text; run: () => void};
      progress?: number | null;                           // 0 到 100；null 不确定进度；不给就没有进度条
      sticky?: boolean;                                   // 常驻；缺省 error 与带动作的常驻
  }
  interface NotificationHandle { id: string; update(patch: Partial<NotificationInput>): void; dismiss(): void }
  interface Notifications { notify(input: NotificationInput): NotificationHandle }
  ```

- 标题、正文与动作名是文字值 `Text`（字符串、语言映射或文字引用，[`ui/i18n`](../ui/i18n.md)）：服务原样放进队列、不改写，视口显示时按窗口的当前语言翻（输出 9）。字符串是不翻译的字面文字，原样显示；发出方要让通知随语言切换，就交文字引用或语言映射，不先折成字符串。文字引用要自己带命名空间（插件用 SDK `/text` 的 `pluginText`）：通知是运行期文字，不经登记补命名空间。
- 文案格式：标题说发生了什么（“书架没有更新”），正文说原因与现在显示的是什么（“取不到作品列表：连接已断开。显示的是上次的数据。”），动作说能做什么（“重试”）。

## 输出与可观察行为

1. **三个去处。** 用户在当前界面就能改的输入（本地校验不过、服务端针对这个字段的拒绝）留在表单里，不发通知：能事先判断的让提交不可用；提交后才知道的把字段标为无效并聚焦，原因写在表单固定位置的状态行，表单排版不变（[UI 规范](../../../packages/nb-ui/docs/ui-development-spec.md)“表单与无障碍”第 8 条）。一次操作做完的结果与后台的失败发通知；整页或整视图不可用（首次取数失败、窗口失败页、视图加载失败）原位显示原因与重试，不发通知。工作台里持续存在的问题（布局未保存、偏好未保存）仍走状态栏条目。
2. **发出。** `notify` 把通知加进本窗口的队列并返回句柄；视口按加入顺序从下往上堆叠在窗口右下角，容器至多 448px 宽，窄屏按视口宽度收窄。
3. **时长。** `sticky` 为真、`tone` 为 `error` 或带 `action` 的通知不自动消失；其余按色调自动消失（info、success 3.2 秒，warning 4.2 秒）。指针停在一条通知上时它的计时暂停，离开后按剩余时间继续、至少再留 0.8 秒。每条通知都有关闭按钮。
4. **动作。** 点动作按钮执行 `run` 并移除该通知；`run` 抛错时通知仍移除，错误记诊断。
5. **更新与移除。** `update` 改标题、正文、色调、动作、进度与常驻；改了色调、动作或 `sticky` 时按新值重算是否常驻并从现在重新计时（进度通知在任务结束后改成 `success` 就会按时消失）；发出时或之后明确给过的 `sticky` 一直算数，直到再次明确改它；指针停在通知上时改了也只重算到期时间，离开后才按剩余时间继续。`dismiss` 立即移除；已消失的通知再 `update` 或 `dismiss` 无效果。
6. **进度。** `progress` 为数字时通知正文下画一条确定进度条，`null` 画不确定进度条（系统设了减少动画时不动）。
7. **寿命。** 队列与 `nbook.workbench` 的浏览器入口同寿：入口停止时清空队列与计时器；页面切换（`/` 与 `/workbench` 之间）不清空。Lab 页面不挂产品视口，Lab 场景要通知时自建队列。
8. **可访问性。** 每条通知是 `role="status"`；关闭按钮有可访问名称；视口不拦截空白处的指针事件。
9. **文字跟随界面语言。** 视口每次渲染时经窗口的翻译端口把标题、正文与动作名翻成当前语言（规则见 [`ui/i18n`](../ui/i18n.md) 输出 2、4）；切换界面语言后，已显示的通知原地换成新语言的文字，不重新发出、不重新计时。动作抛错的诊断里的动作名按记诊断时的语言翻。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 不在队列 | `notify` | 显示中（限时或常驻） |
| 显示中（限时） | 到时 | 移除 |
| 显示中（限时） | 指针进入 | 计时暂停 |
| 计时暂停 | 指针离开 | 显示中（剩余时间，至少 0.8 秒） |
| 显示中 | `update` 改了色调、动作或 `sticky` | 显示中，按新值重算常驻并重新计时 |
| 显示中 | 点动作、点关闭、`dismiss` | 移除 |
| 任一 | 入口停止 | 移除 |

时序与寿命：句柄在通知移除后仍可调用，调用无效果；`run` 在视口的点击处理里同步调用。

## 副作用与数据

无持久化；队列只在内存里。

## 失败与恢复

| 情形 | 行为 |
|---|---|
| `run` 抛错 | 通知移除，错误记诊断（`workbench.notifications`） |
| 没有页面根（视口未挂载） | 通知仍进队列，视口挂上后显示 |

## 边界与兼容

- 公开接口：`notificationsKey`、`Notifications`、`NotificationInput`、`NotificationHandle`（`nbook/plugins/workbench/shared/contracts`）。
- nb-ui 侧：`createNotificationQueue`、`NotificationStack` 的 `queue`、`Notification` 的 `progress`、`Banner`（`@notnotype/nb-ui`）。
- 信任边界：文字按纯文本渲染，不解释 HTML。
- 兼容：`title`、`message` 与动作的 `label` 从 `string` 放宽为 `Text`，传字符串的发出方不用改。nb-ui 队列（`createNotificationQueue`）的同名字段同样放宽，视口经注入的翻译端口翻译。

## 验收与 Smoke

1. Given 书架页，When 刷新失败，Then 右下角出现“书架没有更新”带“重试”且不自动消失；点“重试”后通知消失并重新取数；恢复后不再出现。
2. Given 两个内置页面，When 在 `/` 发出通知后导航到 `/workbench`，Then 通知仍在。
3. Given 一条带进度的通知，When 发出方推进到 100 并改成 success，Then 进度条走到头、通知在 3.2 秒后消失。
4. Given 一条标题、正文与动作名都是文字引用的通知与一条标题是语言映射、正文是字符串的通知，When 界面语言从 zh-CN 切到 en-US，Then 两条通知原地换成英文（字符串不变），同一个通知元素仍在。

Smoke：`notifications.dom.test.ts`（真实队列与视口、宿主翻译引擎，验收 3、4）；`shelf-page.test.ts` 的刷新失败一组（验收 1）；`mount.dom.test.ts`（验收 2：真实窗口、内核与工作台插件，经路由导航换页面。产品里还没有站内去 `/workbench` 的入口，真实浏览器的验收等入口出现时补）；Lab 场景 `NotificationStack`、`Notification`（进度）、`Banner`。

## 实现合同

- **公开入口**：服务键与类型 `notificationsKey`、`Notifications`、`NotificationInput`、`NotificationHandle`（`nbook/plugins/workbench/shared/contracts`）；nb-ui 的 `createNotificationQueue`（`@notnotype/nb-ui/notifications`）与组件 `NotificationStack`、`Notification`、`Banner`。
- **owner 与依赖方向**：`nbook.workbench` 的浏览器入口持有本窗口的队列并提供服务，两个内置页面各挂一个视口显示它；发出方只依赖服务键，不引用工作台的界面。常驻与时长规则在服务里定，nb-ui 的队列只认折算后的时长。
- **关键不变量**：
  - 队列随入口激活建立、停止时清空，不随页面挂载与卸载（输出 7，验收 2）。
  - 明确给过的 `sticky` 保留到再次明确改它；改了色调、动作或 `sticky` 才重算时长（输出 5）。
  - 动作抛错时通知照样移除，错误经诊断记下（输出 4）。
  - 文字原样进队列，翻译只在视口渲染时做（输出 9）：队列与服务里不存翻好的字符串，切换语言不必重推队列。服务只在写动作失败的诊断时经窗口端口翻一次动作名。

## 证据

- 批准依据：开发者 2026-10-11 在 t76 的设计讨论中决定通知按三个去处分工、形式补足到 nb-ui 与应用的通用组件（[t76 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t76-bookshelf-polish/plan.md)）；2026-10-12 同意晋升为 `implemented`，验收 2 先由入口级测试覆盖。标题、正文与动作名改为 `Text`（输出 9、验收 4）依据 [《界面文字的消息目录》](../../proposals/i18n-message-catalogs.md) 第 3 节“跨插件传递”（2026-10-27 接受），由 [w00028 t03](../../../.agents/works/w00028-i18n/tasks/t03-shared-packages-migration/plan.md) 的“SDK 与通知”一片实现。
- 实现入口：[`web/notifications.ts`](../../../packages/neuro-book/src/plugins/workbench/web/notifications.ts)（服务与常驻规则）、[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/workbench/web/plugin.ts)（队列与入口同寿）、[`web/home-page.ts`](../../../packages/neuro-book/src/plugins/workbench/web/home-page.ts)（两个页面挂视口）、[`WorkbenchNotifications.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchNotifications.vue)；nb-ui [`useNotification.ts`](../../../packages/nb-ui/src/composables/useNotification.ts)（队列、计时与悬停暂停）、[`NotificationStack.vue`](../../../packages/nb-ui/src/components/feedback/NotificationStack.vue)
- 合同测试：[`notifications.dom.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/notifications.dom.test.ts)（输出 2 到 5、9，验收 3、4）、[`useNotification.test.ts`](../../../packages/nb-ui/src/composables/useNotification.test.ts)（输出 3 的时长与悬停）、[`NotificationStack.test.ts`](../../../packages/nb-ui/src/components/feedback/NotificationStack.test.ts)、[`shelf-page.test.ts`](../../../packages/neuro-book/src/plugins/projects/shelf-page.test.ts)（验收 1）
- Smoke：[`mount.dom.test.ts`](../../../packages/neuro-book/src/web/mount.dom.test.ts)（验收 2）；Lab 场景 `NotificationStack`、`Notification`、`Banner`
