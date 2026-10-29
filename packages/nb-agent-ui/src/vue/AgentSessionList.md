---
标签: [state:inject]
别名: ["会话列表", "对话列表", "Session List"]
---

# AgentSessionList

会话列表：列出会话，选中一个、或新建一个。它不在对话视图里，是包导出的独立组件，宿主决定摆在哪里：宽屏的左栏、窄屏顶上的下拉，或以后顶栏打开的会话列表弹窗（弹窗在外面加筛选、搜索与翻页，列表本体就是它）。行为合同见 [`ui/agent-conversation-view`](../../../../docs/specs/ui/agent-conversation-view.md) 的“会话列表”。

## 布局

纵向排列，高度随父容器，宽度不设下限：260px 的左栏与 390px 手机上的下拉里都不横向溢出。

- 标题行（`header` 为 true 时）：左边标题，右边“新建会话”图标按钮。
- 列表：每行一个按钮，固定两行，所有行等高（说明、状态、提醒有没有都不改变行高）：
  - 标题（单行截断）与时间同一行；
  - 第二行总在：左边是宿主给的说明，右边依次是提醒（有才显示，提醒色小字，图标加文字）与状态（运行中是转圈加“运行中”，已中断是中性标记，出错是危险色标记；空闲不显示）。宽度不够时说明先截完，提醒再截断，悬停看提醒全文。
- 选中的行强调色浅底、标题强调色，并标 `aria-current="true"`。
- 列表在 `ScrollArea` 里纵向滚动。

## 状态

- `ready` 且有条目：列表。
- `ready` 且没有条目：空状态“还没有会话”。
- `loading`：与空状态同一版式，圆底里是转圈，标题“正在加载会话”。
- `error`：与空状态同一版式，危险色图标，标题是 `errorMessage`（缺省“会话列表没取到”），下面一个“重试”按钮。

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
    locale?: AgentLocale;                         // 只在上面没有注入翻译端口时起作用，缺省 zh-CN
    header?: boolean;                             // 缺省 true
    labels?: Partial<Record<"title" | "create" | "loading" | "empty" | "error" | "retry" | "untitled", string>>;
}
emits: {action: [action: AgentViewAction]}
```

- 时间按本地时区的日历日写：与 `now` 同一天写时刻，前一天写“昨天”，同一年写月日，否则加上年；晚于 `now` 时按同一天写。宿主要定期更新 `now`，否则过了午夜“今天”的行不会变成“昨天”。
- `labels` 覆盖包内文字，给整句；宿主把会话叫成“对话”时用它。英文也由宿主给。

它挂在视图之外，`AgentConversationView` 提供的渲染组件到不了它，也用不到；不持有状态。

## 隐藏通道理由

- `state:inject`：读宿主注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`）取界面文字；宿主要登记本包的目录（`@notnotype/nb-agent-ui/locales`），语言以端口为准。上面没有注入时按 `locale`（缺省 zh-CN）建缺省端口并提供给子组件，见 [README](../../README.md#没有宿主时)。时间的格式也按端口的语言。
