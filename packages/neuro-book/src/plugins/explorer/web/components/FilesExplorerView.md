---
标签: [state:local, env:portal]
别名: ["资源管理器", "Explorer", "文件视图"]
---

# FilesExplorerView

资源管理器视图的界面（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md)）：偏好与根状态的提示、虚拟树、底部结果区，以及右键菜单、删除确认框、展示名对话框与碰撞对话框；拖动的手势与落点反馈在树里。它是受控零件：数据全部经 props 进来，动作经事件交给宿主（`web/view-host.ts`），宿主再执行命令或调控制器；组件不知道命令 id，也不持有文件客户端。

## 布局

视图自己不画工具栏：新建文件、新建文件夹、刷新、全部收起、显示清单文件是视图声明的标题动作，由外壳画在标题行里（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 10）。纵向网格：提示条按内容高度；树 `minmax(0, 1fr)` 占满剩余高度并自己滚动；结果区的行是 `fit-content(40%)`，按内容高度、最多视图高度的 40%，结果区在行内滚动。窄到 `390px` 时树的标签先截断。

- 右键菜单（nb-ui `ContextMenu`，键盘可操作）按 `menu` 的位置与菜单项显示：不可用的项禁用、原因作悬停提示与读屏描述，勾选项画成 `menuitemcheckbox`；点一项发出它的 key（固定动作是命令 id，别的插件经 `explorer.context` 贡献的是 `menu:<贡献 id>`）；菜单关闭时发出 `menu-close`；选择、Escape 或 Tab 关闭时焦点回到树上（菜单项开始的内联输入或对话框会再把焦点拿走），点菜单外关闭时焦点留在被点的地方。
- 删除确认（nb-ui `AlertDialog`）列出受影响的最外层项与数量，说明不能恢复，焦点默认在取消上；受影响项多时只有列表在框内滚动，按钮始终可见。有会丢失未保存修改的打开文档时（`dialog.unsaved`）另列一段。关闭完成（`closed`）后焦点回到树上。
- 复制有未保存修改的文件（`dialog.kind === "dirty-copy"`，nb-ui `Dialog`）：列出这些文档，按钮依次是取消、复制磁盘版本、先保存再复制；`saveable` 为假（其中有文档的视图写不出，editor 输出 61）时没有“先保存再复制”，说明改为只能复制磁盘版本。请求关闭等于取消。
- 展示名对话框（nb-ui `Dialog`）有展示名与图标两个输入框，留空即去掉；提交中禁用按钮。
- 碰撞对话框（nb-ui `Dialog`）：粘贴或拖动移入遇到同名时逐项出现，显示真实的源与目标地址，新名字预填候选名（`名字 (2).扩展名`），有“对其余同名项都这样”；按钮为取消剩余、跳过、改名，Enter 即改名。换到下一项时换成它的候选名；名字不能用时原位提示（`role="alert"`，经 `aria-describedby` 关联输入框）。关闭等于取消剩余。
- 提示条：项目根没有绑定时显示“尚未打开项目”与“打开项目”；某个根停止同步时显示原因与“重新连接”；偏好记录读不到、损坏或没保存上时显示原因与相应按钮（重新读取或重试、放弃）。提示条都在树之外，可用 Tab 到达。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    /** 控制器已建、偏好首读结束：树挂上。 */
    ready: boolean;
    notice: Notice | null;
    problem: FieldProblem | null;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 项目根显示的作品名（书名，没有时是目录原名）；没有绑定项目时不给，显示“项目”。 */
    projectTitle?: string | null;
    /** 正在内联输入的行（见 ExplorerTree）；默认 null。 */
    editing?: {id: string; name: string; error: string | null; busy: boolean} | null;
    /** 打开着的右键菜单：视口坐标与菜单项（`web/menu.ts` 的 `MenuEntry`）；默认 null。 */
    menu?: {x: number; y: number; entries: ReadonlyArray<MenuEntry>} | null;
    /** 打开着的删除确认、展示名、碰撞或“复制有未保存修改的文件”对话框；默认 null。 */
    dialog?: Dialog | null;
    /** 见 ExplorerFeedback。 */
    report?: OperationReport | null;
    running?: {action: "delete" | "copy" | "move"; count: number} | null;
    unknown?: Unknown | null;
    /** 见 ExplorerTree。 */
    startDrag?: (id: string) => boolean;
    drag?: {sources: ReadonlyArray<string>; action: DropAction} | null;
    /** 每次变化都把焦点放回树上（编辑与确认结束后）；默认 0。 */
    focusRequest?: number;
    /** 设置的缩进参考线档位与“隐藏 Markdown 扩展名”，原样交给树；默认 `hover` 与 false。 */
    indentGuides?: "none" | "hover" | "always";
    hideMarkdownExtension?: boolean;
    /** 宿主最近一次提交的结构变化预告（`../tree/motion.ts`），树据此放动画；默认 null。 */
    motion?: MotionNote | null;
};

type Emits = {
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "reconnect", scheme: "project" | "user"): void;
    (event: "open-project"): void;
    (event: "dismiss-notice"): void;
    (event: "prefs-retry"): void;
    (event: "prefs-discard"): void;
    (event: "focus-change", focused: boolean): void;
    (event: "dismiss-report"): void;
    (event: "cancel-running"): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    /** 点了右键菜单的一项：它的 key（`web/menu.ts` 的 `MenuEntry`）。 */
    (event: "menu-command", key: string): void;
    (event: "menu-close"): void;
    (event: "delete-confirm"): void;
    (event: "display-commit", title: string, icon: string): void;
    /** 删除确认点了取消，或展示名、碰撞对话框请求关闭。 */
    (event: "dialog-close"): void;
    /** 碰撞对话框的回答；`all` 是“对其余同名项都这样”。 */
    (event: "collision", choice: {kind: "rename"; name: string} | {kind: "skip"} | {kind: "cancel"}, all: boolean): void;
    /** 回答“复制有未保存修改的文件”。 */
    (event: "dirty-copy", choice: "save" | "disk" | "cancel"): void;
    (event: "recheck"): void;
    (event: "abandon"): void;
    /** 见 ExplorerTree。 */
    (event: "drag-hover", over: DropOver | null): void;
    (event: "drag-drop", over: DropOver | null): void;
    (event: "drag-cancel"): void;
    (event: "drag-expand", id: string): void;
};
```

- 没有 slots；expose `focusTree()`。attrs 落在根元素上。

## 状态

`ready` 为假时树区域显示加载中（占位带 `role="status"` 与 `aria-busy="true"`，读屏软件能得知在忙）；没有行时（不应出现，两个根总在）显示空。

## 隐藏通道理由

- `env:portal`：右键菜单、删除确认、展示名与碰撞对话框经 nb-ui 的 `ContextMenu`、`AlertDialog`、`Dialog` 渲染到 `body`，要脱离侧栏的裁剪与层叠上下文；`body` 总在。
