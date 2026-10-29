---
标签: [state:local, state:inject]
别名: ["资源管理器的行", "Explorer Row"]
---

# ExplorerRow

资源管理器树里的一行（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“行的样子”）：根、资源，或新建时的内联输入行；改名时资源行换成内联输入。资源行按文件夹类型呈现：内容文件夹里显示展示名，真实名字不同时作副标题；内容文件夹与活页夹自己的行去掉 `.content`、`.binder` 后缀，后缀作副标题；节点行的展开箭头与打开区分开，叶子节点没有箭头。图标是 `FileIcon`（catppuccin，按 `fileIconOf` 选）。缺失、未列入、无正文、需要剧情插件、剪切中是行尾弱化色的状态图标，悬停（nb-ui `Tooltip`）显示文字；缺失与剪切中的行淡化，剪切中的行带 `data-explorer-cut`。目录的状态挂在行上（`data-explorer-problem`）：列出中箭头换成转圈并 `aria-busy`；读取失败名字用危险色、行尾一个错误按钮（点它发出 `retry`）；清单不合法名字用警告色、行尾一个警告图标。根是分节标题：12px、加粗、弱化色、没有图标；项目根的标题是 `projectTitle`（作品的显示名），没有时是“项目”，没有绑定项目时标题后跟“尚未打开项目”。行本身不处理键盘，键盘焦点在树上，焦点行以 `active` 标出（`aria-activedescendant` 模式），只在树是键盘带来的焦点（`:focus-visible`）时画 1.5px 的内嵌焦点线，鼠标点行不画。选中不描边，按所在的树有没有焦点（`:focus-within`）分两种：有焦点是强调色浅底与强调色文字，没有是比悬停深一档的灰底与普通字色；悬停与选中的底色带圆角。

## 布局

单行，高度由 `height` 给定（与虚拟列表的行高同一个值，能装下 `Input` 的 `sm`；编辑时行高不变）：缩进、展开箭头（16px，不可展开时占位）、图标（16px）、标签（可收缩、截断）、副标题（更弱、先截断）、行尾的状态图标（靠右、不收缩）。完整路径经 `title` 提示；`aria-description` 是路径加状态与标记的文字。`390×844` 下标签先截断，状态图标保持可见。

缩进参考线：第 1 层到本行上一层各一条 1px 竖线，画在那一层展开箭头的中线（左内边距 8px 加 12px × 层号再加 8px）；根的子项不画。`guideActive` 那一层加深。线的显隐由树根上的变量 `--explorer-guide-opacity` 决定（`ExplorerTree` 按设置给）。

## 数据

```ts
type Props = {
    /** 行数据：`web/tree/rows.ts` 的投影结果。 */
    row: Row;
    /** DOM id：树用它作 `aria-activedescendant` 的目标。 */
    domId: string;
    selected: boolean;
    /** 键盘焦点所在且树拥有焦点：树是键盘带来的焦点时画内嵌焦点线。 */
    active: boolean;
    /** 行高（px）。 */
    height: number;
    /** 项目根的标题（作品的显示名）；没有绑定项目时不给，显示“项目”。 */
    projectTitle?: string | null;
    /** 内联输入：名字、已换成文字的错误、是否在提交；默认 null（不在编辑）。新建的输入行与改名的资源行才会给。 */
    edit?: {name: string; error: string | null; busy: boolean} | null;
    /** 设置“隐藏 Markdown 扩展名”：没有展示名的 `.md` 文件不显示 `.md`；默认 false。改名框里仍是完整名字。 */
    hideMarkdownExtension?: boolean;
    /** 要加深的那一层参考线；默认 null。 */
    guideActive?: number | null;
};

type Emits = {
    /** 按下行：`part` 是展开箭头或行本身；修饰键由事件带出。 */
    (event: "press", mouse: MouseEvent, part: "twisty" | "row"): void;
    /** 双击：以常驻方式打开。 */
    (event: "activate"): void;
    (event: "context", mouse: MouseEvent): void;
    /** 读取失败的目录行点了行尾的错误按钮：重新列出。 */
    (event: "retry"): void;
    /** 内联输入的内容变了。 */
    (event: "edit-input", name: string): void;
    /** Enter（输入法组字中的不算）或输入框失去焦点：提交。 */
    (event: "edit-commit"): void;
    /** Escape：取消；这个按键不再冒泡到树。 */
    (event: "edit-cancel"): void;
};
```

- 资源行与根行是 `role="treeitem"`，带 `aria-level`、`aria-setsize`、`aria-posinset`、`aria-selected`，可展开的带 `aria-expanded`；状态图标是带可访问名称的 `img`，错误按钮的名称是失败原因加“点击重试”，`tabindex="-1"`（键盘用 `nbook.files.retry-list`）。
- 内联输入出现时获得焦点（新建的输入行挂上时、资源行换成改名输入时），改名时选中扩展名之前的部分；提交中输入框只读而不禁用，焦点留在框里，出错后可以接着改；输入行铺选中底色，输入框收在行里（22px 高、6px 圆角、1px 焦点色描边、没有外扩光环）；错误以不占行布局的浮动提示贴在输入框下沿、左右与它对齐（浅危险色底、危险色字与边框，`role="alert"`），并经 `aria-describedby` 关联到输入框，输入框描边同时换成危险色。新建的输入行是 `role="none"`，改名的行仍是 `treeitem` 并保留同层位置、总数、展开状态与路径描述。输入框有可访问名称（“新文件的名字”“新文件夹的名字”“重命名 {名字}”），当前值另由输入框读出。
- 没有 slots、expose；attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：内联输入框的元素引用，只用来在输入行挂上或资源行换成改名输入时把焦点放进去、选中扩展名之前的部分；不保存业务状态。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，根的名字、状态图标的说明与输入框的可访问名称等文字都在本插件的目录（命名空间 `nbook.explorer`，`../../locales/`）；语言随端口切换，不重新挂载，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

除内联输入外不处理键盘与焦点（归树）；不画拖动反馈（归树）；不显示清单里的自定义图标；空目录不画任何东西（展开后下面没有行）。
