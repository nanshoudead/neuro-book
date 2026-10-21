# 实施计划：弹出列表零件（w00030 t03）

2026-10-21 起草。开发者要求用 autonomous-delivery 推进：计划不等确认，先交审查，本该开发者定的点记进 Work 的 [待确认清单](../../pending-confirmations.md)。

## Context

- **为什么做**：nb-ui 的库审查报告 [`lib-review.txt`](../../../w00029-nb-ui-cleanup/tasks/t05-docs-and-specs/evidences/lib-review.txt)（下称报告）指出弹出列表一族文件散在 5 个目录、`composables/` 反向依赖 `components/`（L24）；级联菜单的键盘与“父级滚动收起子级”在三个入口各写一份，已经分叉（L03、L21）；方向键漫游在库内 5 处手写（L22）；行的标记在 4 个组件里各拼一份（L04）。另外浮层材质在 `usePopoverLayer.ts` 里有一份写死的第二登记处（F43），开发者 2026-10-20 定为只认 CSS 类。
- **范围**：总计划 [t01 plan.md](../t01-plan/plan.md) 的“t03：弹出列表”一节与切片表的 t03 S1 到 S5。公开 API 不变（包入口导出的组件名、属性、事件、类型名都不变），数据形状不改；词表与数据形状归 t04。
- **期望结果**：弹出列表的文件在一个目录；级联键盘、父级滚动收起与“级联面板不算外部”各只有一份（`useMenuCascade`）；方向键漫游一个纯函数；行的内部标记一个组件（`MenuRow`）；浮层材质只来自 `.nb-ui-popover-surface .nb-ui-menu-surface`。
- **依据**：[`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)（弹出列表、滚动条两节与自检清单）、[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md)、[`components.md`](../../../../../docs/standards/code/components.md)、各组件同名 `.md`；行为合同以组件同名 `.md` 与现有测试为准，不改 Spec 的行为条目。
- **已定**：F43 只认 CSS 类（w00029 t05 决定记录）；两份级联键盘分叉的细节以 `useMenuCascade` 为准（t01）；调用方的列表导航零件不在本 Work（t01）。
- **工作方式**：worktree `.worktree/w00030-t03-popup-lists`，分支 `refactor/w00030-t03-popup-lists`；主会话自己编码，逐片提交。Task 记录只在主工作区改。旧应用不管。

## 关键设计

### 1. 目录（`packages/nb-ui/src/components/popup/`、`src/utils/`）

移入 `popup/` 的 15 个文件及其同名 `.md`、`.test.ts`：

- `controls/`：`DropdownMenu.vue`、`dropdown-menu.types.ts`、`Menubar.vue`、`MenuNodes.vue`、`MenuLevelPanel.vue`
- `feedback/`：`ContextMenu.vue`、`ContextMenuPanel.vue`、`context-menu.types.ts`、`QuickPick.vue`、`SuggestionMenu.vue`、`suggestion-menu.ts`、`popover-anchor.ts`
- `form/`：`Select.vue`
- `layout/`：`PopupViewport.vue`、`PopupScrollbar.vue`

报告里的另两个文件不进 `popup/`，改放到 `utils/`，消掉反向依赖：

- `feedback/menu-cascade.ts` 拆开：几何（`clampMenuPosition`、`computeCascadePosition`、`measureCascadePanel` 与三个常量）移到 `utils/popup-geometry.ts`；悬停延迟调度 `createSubmenuScheduler` 只给 `useMenuCascade` 用，并进 `composables/useMenuCascade.ts`。
- `usePopupScroll.ts` 里不依赖 Vue 的量取函数（`rectScale`、`measurePopupTruncation`、`revealPopupItem`、`focusPopupItem` 与 `POPUP_*` 常量）一起移到 `utils/popup-geometry.ts`，`measureCascadePanel` 依赖它们。`usePopupScroll` 从那里导入。
- `form/option-highlight.ts` 改名移到 `utils/roving.ts`，本片内容不变，第 3 节再改。

依赖方向变成 `components → composables → utils`，`utils/` 不导入 `composables/` 与 `components/`。`SearchSelect` 是表单控件，留在 `form/`，改从 `popup/` 导入 `SuggestionMenu`。

其余跟着改：`components/index.ts` 的导出路径（导出名不变）；playground 的验收夹具与 `components.test.ts`、`Dialog.test.ts` 的导入；`token-consumption.test.ts` 豁免名单里的路径；Spec [`workbench/quick-open.md`](../../../../../docs/specs/workbench/quick-open.md) 里 `QuickPick.vue`、`QuickPick.test.ts` 的链接（只改路径，随这一片在分支上改，否则分支上 `docs:check` 报断链）。Lab 组件索引按目录分类，这些组件在 Lab 导航里从原分类挪到 popup；Lab 夹具按组件名取组件，不受影响。

这一片只搬文件和改导入路径，不改任何逻辑。拆文件时函数体原样搬，后面几片的 diff 才干净。

### 2. 级联菜单（`composables/useMenuCascade.ts`，三个入口）

`useMenuCascade` 收下现在三个入口各写一份的部分：

```ts
useMenuCascade<T>(options: {
    /** 第一级菜单的条目容器，条目是它的直接子元素。子菜单收起、父级滚动收起时在这里找展开它的那一项。 */
    rootLevel: () => Element | null;
    /** 第一级的上下键、Home、End 由这里处理（右键菜单的第一级是普通按钮）；reka 的第一级由 reka 处理，传 false。 */
    rootRoving: boolean;
}): {
    levels; panels; setPanel; schedule; truncate; reset;   // 不变
    rootKeydown(event: KeyboardEvent): void;               // 挂在第一级上
    levelKeydown(depth: number, event: KeyboardEvent): void; // 挂在每一级级联面板上
    collapseBelow(depth: number): void;                    // 第 depth 级滚动了：收起更深层级，焦点在被收起的层级里就回到展开它的那一项
    contains(target: EventTarget | null): boolean;         // 目标在某一级级联面板里
}
```

- `rootKeydown`：右方向键、Enter、空格落在父项（`aria-haspopup="menu"`）上时，预约把焦点移进新展开的那一级。`rootRoving` 为 true 时另处理上下键、Home、End，焦点停在第一级面板本身时上下键从首末项开始（与 `levelKeydown` 同一套）。`expectKeyboardOpen` 不再导出。
- 找展开项一律 `:scope > [aria-expanded='true']`（只认这一级的直接子项）。三个入口的 `rootLevel`：DropdownMenu 是一级滚动视口（`scroll.viewport`），Menubar 是打开着的那组的 `[data-menubar-level]` 视口，右键菜单是根里的 `.nb-menu-level-content`。三处的条目都是容器的直接子元素。
- 入口里删掉：`ContextMenuPanel` 的 `onKeydown`、`itemsIn`、`focusNewLevel` 监听与 `collapseBelow`；`DropdownMenu`、`Menubar` 的 `collapseBelow`、`onContentKeydown`。右键菜单的键盘改为第一级挂 `rootKeydown`、每一级面板挂 `levelKeydown`，与另两个入口一样（面板与第一级外观层是兄弟，事件不会处理两次）。
- 外部判定：`DropdownMenu.keepOpenForCascade` 与 `Menubar.keepOpen` 里“目标在级联面板里”的判断改调 `cascade.contains`；两处各自取事件目标的写法与 Menubar 另两条理由（退场中的组、按在组标题上）留在原处。
- 行为变化（有意的统一，t01 已定）：右键菜单在父项上按 Enter、空格展开子菜单后，焦点也跟进新的一级（现在只有右方向键会）。

`utils/element-of.ts`：`elementOf(target: unknown): HTMLElement | null`，模板 ref 拿到组件实例时取它的 `$el`。`usePopupScroll.setViewport`、`useMenuCascade.setPanel`、`DropdownMenu` 的两个 ref、`ContextMenu.setMenuRef` 改用它；`measureCascadePanel` 收到的已经是元素，删掉它里面那一处解包。

`measureCascadePanel` 按 `rectScale` 换算：量到的矩形是窗口像素，写回的 `top`、`left`、`width`、`height` 是面板所在坐标系的 CSS 像素，两者在页面或祖先有 CSS `zoom` 时不等；窗口宽高同样换算。比例取级联面板自己的（它没有入场缩放，只有 `zoom` 会让比例不等于 1）。

### 3. 方向键漫游（`utils/roving.ts`）

```ts
export type RovingMove = "next" | "prev" | "first" | "last";
export type RovingOrientation = "horizontal" | "vertical" | "both";
/** 按键对应的移动；不是漫游键时为 null。horizontal 认左右，vertical 认上下，both 都认；Home、End 都认。 */
export function rovingMove(key: string, orientation: RovingOrientation): RovingMove | null;
/** 在可用项之间循环移动；current 不在可用项里时 next 从第一项、prev 从最后一项开始；没有可用项返回 -1。 */
export function moveRoving<T>(items: readonly T[], current: number, move: RovingMove, isDisabled?: (item: T) => boolean): number;
```

- `moveRoving` 就是现在的 `moveHighlight`，参数改成泛型加判定函数，元素列表与数据列表都能用。不加“到端停住”的选项：现在的使用方都循环。
- 改用它的：`QuickPick`、`SearchSelect`（现在用 `moveHighlight`），`useMenuCascade` 的 `rootKeydown`、`levelKeydown`，`Tabs`（horizontal）、`SegmentedControl`（both）。各组件特有的门槛留在原处：QuickPick 的 Ctrl、Cmd 加 Home、End 留给输入框，SegmentedControl 只有一项时不处理。
- Tabs、SegmentedControl 不换 reka 的 `RovingFocusGroup`：它们是“选中跟随焦点”，`RovingFocusGroup` 只移焦点，换过去要另接选中，改动面大于收益。
- 行为变化（边界）：Tabs 的当前值不对应任何标签时，右方向键现在跳到第二个标签（`Math.max(0, -1)` 当成第一个再加一），改后从第一个开始，与 SegmentedControl 一致。记进待确认清单。

### 4. 行组件（`components/popup/MenuRow.vue`，内部零件）

`MenuRow` 画一行里面的几格，行元素本身留在各列表：行元素有五种（reka 菜单项、普通按钮、reka 选择项、`role="option"` 的 `div` 与 `li`），角色、事件与高亮的归属各不相同。行元素上的 `nb-ui-menu-item`、`--multiline`、`-danger` 类照旧由列表给。

```ts
props: {
    label?: string;
    /** 这一级要不要留左侧一列（勾与图标共用）：由列表对整级算一次传下来。 */
    leadColumn: boolean;
    checked?: boolean;      // 左列画勾，替代图标
    icon?: string;          // Iconify 类名
    mutedIcon?: boolean;    // 图标用次要色（Select、SuggestionMenu 现在如此）
    hint?: string;          // 右侧次要文字
    submenu?: boolean;      // 画右箭头，不画 hint 与 right 插槽
}
slots: label（替换整个名称格）、lead（左列里的内容，Select 的状态点）、right（替换 hint 格）、trailing（行尾，QuickPick 的快捷键、SuggestionMenu 的勾）
```

- 多根（几个并列的 `span`），不继承属性。
- 使用方：`MenuNodes` 的两个分支（`item`、`item-right` 插槽照旧转给宿主，`data-menu-shortcut` 照旧挂在 hint 上，e2e 用它）、`Select`（名称格用 `SelectItemText`）、`SuggestionMenu`、`QuickPick`（名称格画命中片段）。
- 各列表的“留不留左列”仍在列表里算：四处规则不同（Select 要画勾就留，MenuNodes 看勾选项与图标，另两个只看图标），合成一个函数要带开关，不比现在清楚。
- 外观不变：四个列表的 DOM 结构与类名和现在一一对应，用截图对照确认。

### 5. 浮层材质（`composables/usePopoverLayer.ts`、`Select`、`ColorSwatches`）

- 删掉 `POPOVER_INLINE_BOX_SHADOW`、`POPOVER_INLINE_BACKDROP_FILTER`、`popoverInlineSurfaceStyle` 与文件末尾的待定注释。
- `Select` 的浮层只绑 `zIndex` 与宽度，`ColorSwatches` 只绑 `zIndex`；材质来自它们已经挂着的 `.nb-ui-popover-surface .nb-ui-menu-surface`（两者的浮层都挂着这两个类）。
- `token-consumption.test.ts` 的浮层材质规则：理由里删掉“或 `usePopoverLayer.ts` 里登记的内联材质”，规则同时禁 `boxShadow:` 内联。
- 外观变化（已定的后果）：Select 与 ColorSwatches 的投影改用主题的 `--elevation-menu`、模糊改用 `--overlay-blur`，与 DropdownMenu 一致。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/quick-open.md` | S1：`QuickPick` 两个链接的路径 |
| 各组件同名 `.md` | S1 随文件移动；S2 `DropdownMenu.md`、`MenuLevelPanel.md`、`ContextMenu.md` 里讲级联键盘的句子；S4 新建 `MenuRow.md` |
| `packages/nb-ui/docs/ui-development-spec.md` | S4：弹出列表一节写“新列表的行用 `MenuRow`，级联用 `useMenuCascade`”；S5：第 127、420 行附近删掉内联材质的待定说明 |
| `docs/standards/code/components.md` | S4：新增弹出列表零件时用 `MenuRow` 与 `useMenuCascade`，不再手写行（按该文件现有写法找位置） |
| `packages/nb-ui/README.md` | 组件目录说明里有分类表的话加 popup |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 第 1 节 | 只有移动、拆文件与导入路径 | nb-ui typecheck、单测；neuro-book typecheck；`docs:check` |
| S2 | 第 2 节 | `useMenuCascade`、三个入口、`element-of.ts`、`popup-geometry.ts` 的换算；先补测试 | nb-ui typecheck、单测；e2e `popup-lists`、`popup-scroll` |
| S3 | 第 3 节 | `roving.ts` 与五个使用方 | nb-ui typecheck、单测；e2e `popup-lists`、`suggestion-menu` |
| S4 | 第 4 节 | `MenuRow` 与四个使用方、文档 | nb-ui typecheck、单测；e2e 三份弹出列表；Lab 弹出列表组件改前改后截图对照 |
| S5 | 第 5 节 | 材质 | nb-ui 单测；Select、ColorSwatches 两主题明暗截图对照 |
| 收口 | — | Task 证据 | nb-ui typecheck、单测、整套 e2e；`bun run test:affected --since master --typecheck`；neuro-book 整套 e2e；`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 搬目录不改行为 | S1 前后 nb-ui 单测与 e2e 原样通过 |
| 三个入口的级联键盘：展开后焦点进第一项、上下循环、左方向键收起回父项 | 现有 `DropdownMenu.test.ts`、`ContextMenu.test.ts` 原样通过；`components.test.ts` 补 Menubar 一例（现在没有） |
| 右键菜单在父项上按 Enter 展开后焦点进第一项 | `ContextMenu.test.ts` 补一例（先在改前确认它失败） |
| 父级滚动收起子菜单，焦点回展开项 | e2e `popup-scroll` 的“级联：父级滚轮或拖滑块时收起”“右键菜单的长子菜单”原样通过 |
| 页面有 CSS `zoom` 时级联面板贴着父项、尺寸不缩 | `popup-scroll.spec.ts` 新增一条：`zoom: 0.8` 下展开子菜单，面板首项与父项同一行、左边贴父级右边加间隙（先在改前确认它失败） |
| 漫游函数 | `utils/roving.test.ts`：循环、跳过禁用、起点不在可用项、无可用项、各方向的按键（`components.test.ts` 里 `moveHighlight` 的用例移过来） |
| Tabs、SegmentedControl、QuickPick、SearchSelect 键盘不变 | 现有单测原样通过；Tabs 补“当前值不对应标签时右方向键到第一个” |
| 行的外观不变 | e2e `popup-lists` 的尺寸与勾、快捷键断言原样通过；Lab 截图对照无差异 |
| 浮层材质只走类 | `token-consumption.test.ts` 规则收紧；Select 浮层的计算样式 `box-shadow` 等于 DropdownMenu 的（e2e `popup-lists` 补一条） |

## 验证

- 每片按上表自跑；e2e 前停掉本机多余的开发服务，跑 e2e 时不改源码。
- 截图：S4、S5 前在固定于 master 的基准 worktree 截 Lab 里弹出列表组件（DropdownMenu、Menubar、ContextMenu、Select、SearchSelect、QuickPick、SuggestionMenu、ColorSwatches）两主题明暗，改后同样截，逐张比像素；S4 期望零差异，S5 期望只有 Select、ColorSwatches 的投影与模糊变化。
- 未验证边界：旧应用不检查。

## 不做与风险

- **不做**：数据形状与词表（t04）；调用方的 7 份列表导航（另开）；`SuggestionMenu` 宿主键盘指引改用 `moveRoving`（`roving.ts` 不进公开入口，t04 定公开面时再说）。报告 L21 说的死代码 `useAnchoredPopup` 已在 w00029 t07 删掉。
- **风险**：
  - 右键菜单的键盘从一个根上的委托改成两处挂载，事件顺序变了：MenuNodes 按钮自己的 keydown（展开）仍先于冒泡到第一级的 `rootKeydown`（预约焦点），与现在相同；靠 `ContextMenu.test.ts` 守。
  - `rootLevel` 选错容器时 `:scope >` 找不到展开项，表现为左方向键与滚动收起后焦点丢失；三个入口各有测试或 e2e 覆盖左方向键或滚动收起。
  - `MenuRow` 多根组件放进 reka 的 `SelectItem` 里：reka 只关心 `SelectItemText`，不受影响；由 Select 的单测与 e2e 守。
