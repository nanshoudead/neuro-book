---
标签: []
别名: ["会话列表", "对话列表", "Session List"]
---

# AgentSessionList

会话列表：列出会话，选中一个、或新建一个。它不在对话视图里，是包导出的独立组件，宿主决定摆在哪里：宽屏的左栏、窄屏顶上的下拉，或以后顶栏打开的会话列表弹窗（弹窗在外面加筛选、搜索与翻页，列表本体就是它）。行为合同见 [`ui/agent-conversation-view`](../../../../docs/specs/ui/agent-conversation-view.md) 的“会话列表”。

## 布局

纵向排列，高度随父容器，宽度不设下限：260px 的左栏与 390px 手机上的下拉里都不横向溢出。

- 标题行（`header` 为 true 时）：左边标题，右边“新建会话”图标按钮。
- 列表：每行一个按钮，内容三行：
  - 标题（单行截断）与时间同一行；
  - 宿主给的说明与状态同一行：运行中是转圈加“运行中”，已中断是中性标记，出错是危险色标记；空闲不显示状态；
  - 提醒（有才显示）：提醒色小字，图标加文字。
- 选中的行强调色浅底、标题强调色，并标 `aria-current="true"`。
- 列表在 `ScrollArea` 里纵向滚动。

## 状态

- `ready` 且有条目：列表。
- `ready` 且没有条目：空状态“还没有会话”。
- `loading`：转圈加“正在加载会话”。
- `error`：危险色说明（`errorMessage`，缺省“会话列表没取到”）加“重试”按钮。

三种状态都保留标题行与新建按钮。

## 交互

| 操作 | 发出的 action |
|---|---|
| 点一行（含已选中的） | `session.select {sessionId}` |
| 点新建 | `session.create {}` |
| 出错时点重试 | `sessions.refresh` |

- 组件不持有展开状态，也不去重：放在下拉里时，宿主收到 `session.select` 或 `session.create` 后自己关下拉；`sessions.refresh` 不关。
- 是导航式列表：每行一个按钮，Tab 逐行经过，不是 `listbox`，不做方向键漫游。

## 数据

```ts
type AgentSessionListItem = {
    id: string;
    title: string;                 // 空串时显示“未命名会话”
    description?: string;          // 第二行的补充说明
    updatedAt: number;             // 最近活动的时刻（毫秒）
    status: "idle" | "running" | "interrupted" | "error";   // 宿主按自己的状态映射
    note?: {text: string; icon?: string};                   // 提醒，图标缺省 i-lucide-circle-alert
};

props: {
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    state?: "ready" | "loading" | "error";       // 缺省 ready
    errorMessage?: string;
    now: number;                                  // 宿主给的当前时间
    locale: AgentLocale;
    header?: boolean;                             // 缺省 true
    labels?: Partial<Record<"title" | "create" | "loading" | "empty" | "error" | "retry" | "untitled", string>>;
}
emits: {action: [action: AgentViewAction]}
```

- 时间按本地时区的日历日写：与 `now` 同一天写时刻，前一天写“昨天”，同一年写月日，否则加上年；晚于 `now` 时按同一天写。宿主要定期更新 `now`，否则过了午夜“今天”的行不会变成“昨天”。
- `labels` 覆盖包内文字，给整句；宿主把会话叫成“对话”时用它。英文也由宿主给。

不 inject：它挂在视图之外，`AgentConversationView` 提供的语言与渲染组件到不了它，语言经 `locale` 给。没有隐藏通道，不持有状态。
