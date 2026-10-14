---
标签: [state:local, state:shared-read, state:shared-write, io:mutate]
别名: ["工作台外壳", "Workbench"]
---

# WorkbenchShell

产品的工作台外壳（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一、外壳二）：把工作台的布局 store 接到纯布局组件 [`WorkbenchShellLayout`](WorkbenchShellLayout.md)，在七个 Part 里放内容，并把框架按钮、状态栏按钮接到五条面板命令；工具区域放容器与视图，“移动到”菜单接到 `nbook.view.move-view`。它是工作台在窗口里的唯一布局宿主：布局的读写只经它与 store 的 action。

## 布局

外壳根占满页面（父级给它确定的宽高），底色是主题的 `--shell-ground`（卡片外壳里是窗体底，平铺的主题没有这个变量、用面板底色 `--panel-surface`，[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38），字体 `--font-ui`，文字 `--text-main`。七个 Part 的内容：

- 标题栏：[`WorkbenchTitleBar`](WorkbenchTitleBar.md)，显示当前作品的显示名（书名，没有时是目录原名）。
- ActivityBar：[`WorkbenchActivityBar`](WorkbenchActivityBar.md)，上段是 Sidebar 的容器切换，底段是 `chrome` 给的全局项（`workbench.activitybar-items`，输出 40）。
- 侧栏与右栏：各一个 [`WorkbenchToolPartHost`](WorkbenchToolPartHost.md)；区域里没有视图时一句空状态说明。
- 编辑器：稳定内容槽。`editorArea` 有提供者时挂它的组件（属性 `context: {visible}`，面板最大化时 `visible` 为假，从最大化往回拖的过程中为真），提供者换了才重挂，加载期间是一句给读屏的“正在加载编辑器”（`role="status"`，带 `aria-busy="true"` 与 `data-workbench-editor-loading`），加载失败显示原因（`role="alert"`）；没有提供者时放欢迎文字（应用名与“工作台已就绪”一句，语言跟随配置）。最大化、换位置时停放不卸载。
- 面板：[`WorkbenchPanelSurface`](WorkbenchPanelSurface.md)，框架按钮依次是位置、对齐、收起、最大化、隐藏；有容器时导航槽里是容器标签带（与 single 时上提的“移动到”，它包在 `data-no-drag` 里：标签带是落点，这个按钮不是），内容区是 Panel 的 `WorkbenchToolPartHost`。
- 容器与视图实例：[`WorkbenchViewInstances`](WorkbenchViewInstances.md) 放在外壳根里、布局组件旁边，把容器宿主与视图实例搬进三个工具区域的落点；三层 Teleport 共用外壳自己的一份滚动与焦点记忆。
- 状态栏：[`WorkbenchStatusBar`](WorkbenchStatusBar.md)。
- 视图标题动作：视图声明的 `actions` 与别的插件经 `workbench.view-title` 给它贡献的动作，由共享组件 [`TitleActions`](../../../../ui/menus/TitleActions.md) 画在“移动到”之前：single 的侧栏与右栏在容器标题行，面板在标签带旁，multiple 在各视图标题行（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 10、11）。按钮与“⋯”的内容、可用与按下态、执行都经 `chrome`（`viewActions`、`runViewAction`），执行按动作的 key 找回动作，要实例的带上实例层报上来的代际；“⋯”的菜单身份与“移动到”相同（视图、所在容器与模式、交付状态、代际）。Lab 里没有 `chrome` 时不画。

ActivityBar、侧栏、右栏与面板画面板底色，自己不画外框、圆角与留白；卡片外壳的缝、圆角与投影由 `WorkbenchShellLayout` 按主题变量画，平铺时部件之间的线只有外壳网格边界的接缝。右栏与面板空着时缺省不显示（输出 39），规则在布局 store 里，组件只读生效的显隐。

## 交互

- 拖动边界的结果交给 store 的 `commitSizes`；布局组件的呈现事实交给 `acceptLayoutFacts`；记录读完之前边界不能拖。
- 面板框架按钮执行对应命令（位置与对齐不带参数，由命令弹出选择）；按钮的可用与原因取命令系统的可用性，随布局状态更新。
- 状态栏面板按钮执行 `nbook.view.set-panel-hidden`（显示时同时清除收起）；重试、放弃转给 store 的 `retry`、`discard`。
- 工具区域的可见：未隐藏、未拖到零的区域，加上外壳布局按手势预览报上来的、正被拉出来的区域（`preview` 事件）；视图的首次加载与 `context.visible` 都按它算，所以拖到零的面板第一次拉出时视图在拖动中就加载。
- ActivityBar 点容器：选中它，Sidebar 被隐藏或拖到零时同时打开（拖到零的按记忆尺寸展开）。点底段的全局项：经 `chrome.runItem` 执行它声明的命令。标签带切容器、容器网格的尺寸与收起都经 store 的 `applyView`。
- “移动到”：选目标执行 `nbook.view.move-view`（带打开菜单时记下的来源容器），“重置位置”经 `applyView`。菜单目标身份由视图、来源容器、容器模式、交付状态与实例代际（实例层报上来）拼成，任一变化即关闭菜单。

## 数据

```ts
type Props = {
    /** 工作台的布局 store（`state/layout-store.ts`），由页面在挂载时取得；外壳只读它的状态、调它的 action。 */
    layout: LayoutStore;
    /** 命令服务：框架按钮与状态栏按钮执行面板命令，按钮的可用性也问它；“移动到”执行 move-view。 */
    commands: CommandService;
    /** 视图注册表（`views/registry.ts`）：交付状态、加载与重试，交给实例层。 */
    views: ViewSource;
    /** 编辑器槽的提供者（`editor-area.ts`）：`workbench.editor-area` 里 `order` 最小的贡献；可选，缺省为欢迎文字。 */
    editorArea?: EditorAreaSource;
    /** 标题栏的菜单与搜索、标题栏与状态栏的条目、活动栏底部的条目（`titlebar/titlebar-source.ts`）；可选，缺省时标题栏只有品牌与项目名，条目都为空。 */
    chrome?: ShellChrome;
    /** 当前项目的显示名；没有绑定项目为 null。 */
    project: string | null;
    /** 当前显示语言。 */
    locale: DisplayLocale;
};
```

没有 emits、slots、expose；attrs 落在纯布局组件的根上。纯布局组件与实例层外面包一层可编程聚焦的宿主根（`tabindex="-1"`），焦点所在内容被停放时交给它。

## 隐藏通道理由

- `state:shared-read`、`state:shared-write`：布局 store 是工作台布局的唯一写者，外壳是把用户操作接到它的宿主；store 以 prop 传入（不经注入），读写都经它的只读视图与 action。
- `io:mutate`：执行面板命令。命令系统是这些动作的唯一入口（命令面板、Agent、按钮共用），外壳在这里执行而不是把命令 id 传给零件：零件不认识命令。
- `state:local`：没有自己的持久状态，只有派生的按钮列表。

## 不支持

不在 Lab 挂载（会写产品布局记录），在产品页验收；纯布局与面板、状态栏零件各有 Lab 场景。
