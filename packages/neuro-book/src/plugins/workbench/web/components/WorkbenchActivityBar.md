---
标签: [state:inject]
别名: ["活动栏", "Activity Bar"]
---

# WorkbenchActivityBar

主体左侧的通高列，画面板底色、自己不画外框与圆角（卡片外壳里外壳给它套卡片、与侧栏相连，[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38）：上段是 Sidebar 的 Switcher，一个容器一个图标按钮；底段是插件经贡献点 `workbench.activitybar-items` 交来的全局项（输出 40：现在是头像占位与设置齿轮）。它只画按钮、选中标记与按下态，点了只发 `select` 或 `run-item`；切换哪个容器、要不要收起或打开 Sidebar、执行哪条命令，由宿主决定（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 15）。

## 布局

宽度由外壳的 ActivityBar 叶决定（48px），按钮用 `IconButton` 的 38px 档（`lg`）、竖排、间距 4px，滚动区上下各留 4px：左右与上下都给外扩焦点光环留出余地，不被滚动区裁掉；容器多到放不下时，排在后面的收进上段末尾的“更多”（同样是 38px 的按钮，下拉列出收起来的容器），与状态栏条目同一个预算（`items/item-strip.ts` 的 `layoutStrip`），选中的优先、总在外面；量不到上段高度（还没挂上）时全部摆出来，上段自己纵向滚动兜底，不撑破列。选中标记只在 `sidebarVisible` 为 true 时出现：Sidebar 看不见时没有“当前在看”的容器。

底段贴着列底，按 `items` 的顺序从上往下排，不滚动、不让位（放不下时上段先把末尾的容器收进“更多”）：

- 有命令的条目是与上段同样的 38px 图标按钮（淡色图标，悬停灰底、正文色）；声明了切换状态且为真时画成按下：灰底、图标正文色，不用强调色（强调色留给上段的“当前容器”）。
- 没有命令的条目是不可点的占位，样子同书架右上角的头像位：30px 的圆、细外框、控件底色、淡色图标，放在 38px 的格子里居中。

## 交互

- 点任何一个按钮都发 `select(id)`，包括已选中的那个（宿主据此收起看得见的 Sidebar、打开被隐藏或拖到零的 Sidebar）。
- 每个按钮也是整容器的拖动源，上段是 Sidebar 的 Switcher 条目带（外壳三输出 19–23）：组件只写标记，拖动由外壳的拖放会话处理。按住移动或聚焦后按空格拿起；按钮带 `aria-description`，文字取端口里的拖动提示。
- 每个按钮是普通按钮，各自是一个 Tab 停靠点；`aria-pressed` 表示它是 Sidebar 当前显示的容器；悬停提示与可访问名称是容器标题。
- 底段有命令的条目点了发 `run-item(id)`；命令不可用时按钮停用，悬停提示是原因（原生 `title`：停用的按钮不触发悬停提示组件）。声明了切换状态的条目带 `aria-pressed`。
- 底段的占位不可聚焦、不可点，悬停提示是条目标题（例如“个人资料尚未开放”），读屏读作一张带这个名字的图（`role="img"`）。
- 整条是一个 `nav` 地标，名称由 `label` 给出。

## 数据

```ts
type ActivityContainer = {
    /** 容器 id，`select` 原样带回。 */
    id: string;
    /** 容器标题（已按当前语言取好）：可访问名称与悬停提示。 */
    label: string;
    /** nb-ui 图标 class。 */
    icon: string;
};

type ActivityItem = {
    /** 条目 id，`run-item` 原样带回。 */
    id: string;
    /** 条目标题（已按当前语言取好）：可访问名称与悬停提示。 */
    title: string;
    /** nb-ui 图标 class。 */
    icon: string;
    /** 有命令：按钮；没有：不可点的占位。只看是不是 null。 */
    command: {id: string; args: Record<string, unknown>} | null;
    /** 声明了切换状态时是按下与否；不是切换按钮为 null。 */
    pressed: boolean | null;
    /** 命令此刻不可用的原因；可用或没有命令为 null。 */
    disabledReason: string | null;
};

type Props = {
    /** 地标名称。 */
    label: string;
    /** Sidebar 里的容器，按顺序；受控。 */
    containers: ReadonlyArray<ActivityContainer>;
    /** Sidebar 选中的容器；没有容器时为 null。受控。 */
    selected: string | null;
    /** Sidebar 此刻看得见（未隐藏、未拖到零）；受控。 */
    sidebarVisible: boolean;
    /** 底段的全局项，已按顺序排好；缺省没有。受控。 */
    items?: ReadonlyArray<ActivityItem>;
};

type Emits = {
    (event: "select", id: string): void;
    /** 点了底段一个可用的条目。 */
    (event: "run-item", id: string): void;
};
```

没有 slot、没有 expose；attrs 落在根 `<nav>` 上。上段带 `data-switcher-band="sidebar"`，每个按钮带 `data-switcher-entry` 与 `data-drag-container`（容器 id）。底段带 `data-activity-items`，每个条目带 `data-activity-item`（条目 id），占位另带 `data-activity-item-placeholder`。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，拖动提示与“更多”按钮的名称都在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口响应式切换，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不处理拖放手势（会话按标记处理）；没有角标、右键菜单与溢出菜单；不读写任何状态，不执行命令；底段的条目不能拖动、不参与选中。
