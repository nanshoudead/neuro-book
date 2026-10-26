# 实施计划：nb-ui 库结构整理（w00030）

2026-10-20 起草；同日开发者在评审板上确认“待开发者确认”的第 1 到 4 项与其余部分（都取推荐），第 5 项在 w00029 t05 的评审板上定为“只认 CSS 类”；随后在会话里把第 1 项改定为统一用 Tailwind v4（t02 一节已按此重写）。

## Context

- **起因**：w00029 t05 期间开发者要求审查 nb-ui 作为 UI 库的复用、耦合、可维护性与 API 形状，报告是 [`lib-review.txt`](../../../w00029-nb-ui-cleanup/tasks/t05-docs-and-specs/evidences/lib-review.txt)（下称报告，条目 L01 到 L24）。整改顺序第 1 步已在 w00029 t07 做完（L09、L07 第 1、3 点、L02、L14 第 1 至 3 点，`93a833251`、`be272cfa8`）。本 Work 做第 2 到 4 步；开发者 2026-10-20 同意按这个拆法，先写计划再实施。
- **期望结果**：
  1. 同一个 nb-ui 组件在任何宿主里渲染相同，宿主不再为 nb-ui 写补丁。
  2. 弹出列表一族放进一个目录，键盘、定位、行的标记各只有一份。
  3. 浮层、尺寸、语调、文案的公开 API 各只有一套写法，调用方一次迁完。
- **依据**：nb-ui 规范 [`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)、[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md)；组件契约 [`components.md`](../../../../../docs/standards/code/components.md) 与各组件同名 `.md`；测试 [`docs/testing/README.md`](../../../../../docs/testing/README.md)。
- **约束**：
  - 代码在 worktree 写，记录只在主工作区。
  - 旧应用（`neuro-book-legacy`，205 个文件引用 nb-ui）不改、不检查。w00029 的改名与删除已经让它对不上新 API，本 Work 同样不顾及它。
  - 布局引擎拆包（L20）不在本 Work。

### 与 w00027 t07 的先后

w00027 t07（低代码表单）在 Work 分支 `feat/w00027-plugin-platform` 上改了 nb-ui：S2a、S2b 共 29 个文件，包括 `Field`、只读、`invalid`、`SearchSelect` 和读屏名称属性。这些改动还没进 master；它的 S3 到 S5 在 nb-form 与设置页里大量调用 nb-ui。本 Work 改的正是同一批组件的模板与公开属性，因此：

- **t02（统一 Tailwind）、t03（弹出列表零件）**：等 w00027 t07 的 S2a、S2b 进 master 后开工，否则模板几乎每行都会冲突。这两个 Task 不改公开 API，nb-form 不受影响。
- **t04（公开 API 对齐）**：等 w00027 t07 完成（S5，设置改用 `SchemaField`）并合入后开工，nb-form 与设置页一起列进迁移表。提前做的话，w00027 要按新名字返工一遍。
- **w00029 t05（规范文档整理）**：仍排在 w00027 t07 S3 之后。t02、t03 不改规范的结构；t04 改的是组件同名 `.md` 与规范里的词表一节，t05 若先做，t04 只追加改动。

## 关键设计

### Task 划分

| Task | 内容 | 报告条目 |
|---|---|---|
| t02 | 全仓统一用 Tailwind v4，宿主编译 nb-ui 源码；滚动条 token | L01、L06、L18 的产物部分 |
| t03 | 弹出列表一族搬目录，级联键盘、方向键漫游、行组件各收成一份；浮层材质只走 CSS 类 | L24、L03、L21、L22、L04 的内部部分、F43 |
| t04 | 公开 API 一次对齐，附迁移表 | L05、L10、L08、L12、L16、L04 的数据形状、L07 第 2、4 点、L14 第 4、5 点、L19 的同名类型 |

每个 Task 一条分支、一个 worktree，验证后合入 master 再开下一个。

### t02：统一用 Tailwind v4，宿主编译 nb-ui（`packages/nb-ui`、`packages/neuro-book`、nb-story、dev-panel）

开发者 2026-10-20 改定（取代评审板第 1 题的“加前缀”）：全仓统一用 Tailwind v4，nb-ui 不再发预编译的原子类产物，宿主的 Tailwind 直接扫描 nb-ui 源码，一个页面只有一个引擎、一份输出。根因是同一页面上并存 UnoCSS（neuro-book，ADR 0023 沿用旧应用）与 Tailwind（nb-ui、nb-story、dev-panel）两套引擎，L01、坑 58、neuro-book 的位移类封禁名单、nb-story 与 dev-panel 的分层迁就都是它的症状。旧应用靠 `dist/nb-ui.css` 拿样式，产物删掉后它的样式失效，开发者定不管它。

**nb-ui 的样式入口**：新导出 `@notnotype/nb-ui/tailwind.css`，取代 `./styles.css` 与 `dist/nb-ui.css`。宿主写：

```css
@import "tailwindcss";
@import "@notnotype/nb-ui/tailwind.css";
```

这个入口里放：

- `@source` 指向 nb-ui 的 `src/components`、`src/composables`（相对入口文件，排除测试），宿主不用知道 nb-ui 的目录。
- `@theme`：nb-ui 与 Tailwind 主题键同名的 token（`--text-*`、`--leading-*`、`--font-*` 等）在这里声明成主题值，`text-sm` 就明确是 nb-ui 的 13px，不再靠样式顺序碰巧取到。具体保留、清空哪些 Tailwind 缺省刻度，S1 列出清单。
- token（`tokens.css`）进 `@layer base`；主题包的 `vars.css` 照旧无层、靠特异性覆盖，不受影响。
- 语义类（`styles.css`）进 `@layer components`：调用方给组件传的原子类在 `utilities` 层，自然能覆盖它，这是 Tailwind 的标准用法。
- 图标：`@iconify/tailwind4` 插件与遮罩垫片由这个入口提供，垫片放 `@layer base`，宿主不再各写一份。垫片的 `width: 1em` 在 base 层，输给 components 层的菜单图标尺寸，坑 58 不会再出现；宿主自己的图标类也走同一个插件。

**分层后要换写法的地方**：`tailwind.css` 现在第 2 条取舍说的 `invalid` 边框（语义类 `.nb-ui-control-invalid:hover` 靠特异性压过模板里的 `hover:border-…`）分层后会被悬停边框盖住，改成模板里的 `aria-invalid:` 变体写在 utilities 层。S2 开头扫一遍语义类与模板原子类同时设同一属性的地方，逐处列出并改写。

**删掉的东西**：`dist/nb-ui.css`、`build:css`、`src/dist-css.test.ts`、`package.json` 的 `./styles.css` 导出、Nuxt 模块的 `injectCss`（只有 playground 用，它改为在自己的样式入口导入 nb-ui 的入口）；neuro-book 的 `uno.config.ts`、`unocss` 依赖与 `boot.ts` 的导入顺序约定；nb-story、dev-panel 的“preflight 进 layer、utilities 不进 layer”拆分写法。L18 的入库产物随之解决。

**neuro-book 从 UnoCSS 换到 Tailwind v4**：细化与实测的改动面见 [t02 的 plan.md](../t02-tailwind-unify/plan.md)。实测比这里原先的粗估小得多：除图标外没有 Tailwind 编不出的类，要改名的只有 10 处；宿主小字从 14px 变 13px，开发者 2026-10-20 认为影响不大。

**测试里的类名断言**：报告统计 48 处，原子类名不变（不加前缀），只有层的变化可能翻转结果；断言计算样式的不受影响，按类名断言的顺手改成读计算样式。

**滚动条 token（L06）**：

- `tokens.css` 加 `--scrollbar-thumb`、`--scrollbar-thumb-hover`、`--scrollbar-w`，`ScrollArea`、`OverlayScrollbar`、`PopupScrollbar` 都从这里取。
- 加 `.nb-ui-scrollbar-thin`（原生细滚动条加同一组颜色）。三个宿主各自手写的 `* { scrollbar-width… }` 改为挂这个类。
- `overlay-scrollbar.ts` 的 `thumbGeometry` 与 `usePopupScroll` 的滑块几何合成一个函数，最短滑块取一个值。


### t03：弹出列表（新目录 `packages/nb-ui/src/components/popup/`）

**搬目录（L24）**：

- 报告列的 17 个文件移入 `popup/`。`index.ts` 改导出路径，公开名字不变；组件同名 `.md` 一起移。
- `menu-cascade.ts` 的纯几何部分（`computeCascadePosition`、`measureCascadePanel`、`clampMenuPosition`）移到 `utils/popup-geometry.ts`，依赖方向变成 `components → composables → utils`。
- 这一步单独一个提交，只搬不改，后面的合并 diff 才干净。

**级联菜单（L03、L21）**：

- `useMenuCascade` 接受第 0 级容器 `rootPanel: () => HTMLElement | null`，`levelKeydown`、`collapseBelow`、`isInside(target)` 都收进来。
- `ContextMenuPanel` 的 `onKeydown` 整段删掉。`DropdownMenu`、`Menubar` 的 `collapseBelow`、`onContentKeydown`、`keepOpen…` 缩成一行调用。
- 两份拷贝已分叉的细节以 `useMenuCascade` 为准：ArrowRight 同时认 Enter 与空格；找展开项用 `:scope >`。
- `$el` 解包抽成 `utils/element-of.ts`，6 处都改用它。
- `measureCascadePanel` 加 `rectScale` 换算，与 `usePopupScroll` 一致。

**方向键漫游（L22，只做库内）**：

- 加纯函数 `utils/roving.ts`：`moveRoving(items, current, key, {loop, orientation})`，`option-highlight.ts` 并进来。
- `Tabs`、`SegmentedControl` 改用 reka 的 `RovingFocusGroup`，或用这个函数，以测试通过、行为不变为准。
- `QuickPick`、`useMenuCascade` 改用这个函数。
- 调用方的 7 份手写（书架、文件浏览、设置页列表等）与公开的列表导航零件不在本 Work，另开。

**行组件（L04 的内部部分）**：

- 内部组件 `popup/MenuRow.vue`。属性：`label`、`hint`、`icon`、`checked`、`tone`、`disabled`、`multiline`、`leadColumn`。
- “勾与图标共用一列、有一项需要就每行留出”的判断由父级算一次传下来，对应 t04 决定 8。
- `MenuNodes` 的两个分支、`Select`、`SuggestionMenu`、`QuickPick` 都渲染它。
- 数据形状此时不改，各组件在自己那里把字段映射到 `MenuRow` 的属性。

**浮层材质（F43，待开发者定，推荐“只走 CSS 类”）**：

- 删掉 `usePopoverLayer.ts` 里的 `POPOVER_INLINE_BOX_SHADOW`、`POPOVER_INLINE_BACKDROP_FILTER`、`popoverInlineSurfaceStyle`。
- `Select`、`ColorSwatches` 的浮层只绑层级，材质靠 `.nb-ui-popover-surface .nb-ui-menu-surface`。
- `token-consumption.test.ts` 的材质规则去掉对 composable 的放行。
- 后果：Select 的投影与模糊跟随主题，暗色下变成主题的暗色投影，与 DropdownMenu 一致；要截图确认。

### t04：公开 API 对齐（迁移表见下）

**前置**：给 neuro-book、nb-story、dev-panel、nb-form 的 `tsconfig` 打开 `vueCompilerOptions.checkUnknownProps` 与 `checkUnknownEvents`。现在没开，改了名的属性会静默落成 attrs，类型检查查不出来。先单独一个提交把现有的报错清掉，再改名。

**不留旧名别名**：调用方都在仓库里，同一个提交里一起改。改名靠上面的检查兜住；别名只会变成第二套写法。

**浮层合同（L05、L16）**：

- 打开态一律 `open?: boolean` 加 `update:open`，用 `defineModel`，可选受控。
- 关闭原因统一为 `OverlayCloseReason = "escape" | "outside" | "button" | "action" | "tab"`；关闭前先发 `close(reason)`；退场完成发 `closed`。
- 内部 `popup/ModalShell.vue` 负责传送、遮罩（`.nb-ui-overlay`，`--overlay-bg`）、`useModalLayer`、提供局部浮层层级、关闭交接。`Dialog`、`AlertDialog`、`Drawer`、`QuickPick` 都套它。
- 遮罩上 `animate-in` 这一类在产物里不存在的类删掉，换成一对关键帧。

**Dialog 拆分（L12）**：

- 浮动窗口拆成 `FloatingWindow`，带 `resizable`、`minWidth`、`minHeight`、`update:width`、`update:height`；与 `Dialog` 共用内部外框 `DialogSurface`。
- `Dialog` 只做模态。
- 去掉“看宿主有没有挂监听”的分支：`request-close` 总是发；`closeOnRequest` 缺省为自动关闭，调用方要自己决定时显式传 `false`。
- `cancel` 只在取消按钮路径发。
- 判断“遮罩在不在最上层”改用 `useModalLayer` 的叠放序号，不再读 reka 的 `data-dismissable-layer`。

**词表（L10）**：共享类型放 `components/shared-types.ts` 并导出。

- `ControlSize = "xs" | "sm" | "md" | "lg"`：`default` 改为 `md`，Input 的无效别名删掉。
- `Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"`：`error` 改为 `danger`，各组件声明自己支持的子集。
- `Orientation`。弹出位置统一为 `side` 加 `align`，`Tooltip`、`InfoTip`、`SuggestionMenu` 的 `placement` 改为 `side`。
- `NotificationTone` 只定义一份（L19）。
- `AlertDialog.tone` 删到 `danger | default`：现在三档里只有一档有效果。
- 删掉没人用的 `DropdownMenu.popoverStyle`、`contentProps`。

**文案（L08）**：

- 按钮与可访问名称一律叫 `xxxLabel`，说明文字一律叫 `xxxText`。`AlertDialog` 的 `confirmText`、`cancelText` 改为 `confirmLabel`、`cancelLabel`，与 `Dialog` 一致。
- `Drawer` 关闭按钮补 `closeLabel`。
- w00027 S2b 已经补了 `Input`、`NumberInput` 的读屏名称属性；剩下没有覆盖入口的（`ColorPickerPanel`、`Breadcrumb`、`Slider`、`Splitter`）补属性。
- 不做全局文案注入：目前只有中文一种语言。

**列表数据形状（L04）**：

- 共同字段 `{id, label, hint?, description?, icon?, tone?, disabled?}`。
- 菜单的 `shortcut` 改为 `hint`；`value` 与 `id` 统一为 `id`；勾选类型统一为 `type: "item" | "checkbox" | "radio"`。
- `Select` 的 `indicatorClass` 改为 `tone`，由库映射到 token 色，不再让调用方传色类。
- `iconClass` 改名 `icon`，仍是 Iconify 类名。

**其余**：

- L07 第 2 点：`Tooltip` 用 `max(注入的浮层层级, NB_Z_INDEX.tooltip)`，让提示压过菜单。
- L07 第 4 点：`ContextMenu`、`SuggestionMenu`、`Menubar` 的传送目标缺省读 `useTeleportTarget`，原有 `teleportTarget` 属性保留为显式覆盖。
- L14 第 4、5 点：`./layout` 只导出宿主在用的几何函数与类型，求解器留在包内；`./grid` 并进 `./layout`；根入口 `.` 加组件的重导出，或在 README 写明组件只从 `./components` 取。推荐后者。

## 迁移表（t04；调用方次数是 2026-10-20 master 上的统计，开工时按 w00027 合入后重新统计）

| 改动 | 旧 | 新 | 调用方 |
|---|---|---|---|
| 打开态 | `Dialog` 的 `v-model`；`ContextMenu` 的 `visible` | `v-model:open` | `Dialog` 18 处，`ContextMenu` 5 处 |
| 关闭原因 | `DialogCloseReason` 的 `overlay`、`esc`、`cancel`、`close-button` | `outside`、`escape`、`button` | `@request-close` 11 处，类型 2 处 |
| 浮动窗口 | `<Dialog :modal="false">` | `<FloatingWindow>` | `SettingsWindow` 与 Lab 夹具 |
| 文案属性 | `AlertDialog` 的 `confirm-text`、`cancel-text` | `confirm-label`、`cancel-label` | 7 处 |
| 弹出位置 | `placement` | `side` | 10 处 |
| 菜单项字段 | `shortcut`、`value`、`type: "default"` | `hint`、`id`、`type: "item"` | `shortcut:` 70 处（含命令快捷键定义，开工时按菜单数据筛） |
| 选项色点 | `indicatorClass` | `tone` | 3 处 |
| 尺寸、语调 | `size="default"`、`tone="error"` | `md`、`danger` | 写成字面量的 0 处，以类型检查为准 |
| 布局入口 | `@notnotype/nb-ui/grid` | `@notnotype/nb-ui/layout` | 2 处 |

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/adr/0023-v2-frontend-backend-stack.md` | t02：前端的原子 CSS 改为 Tailwind v4，宿主编译 nb-ui 源码 |
| `packages/nb-ui/README.md`、样式入口头注释、`docs/modules/monorepo-boundaries.md` | t02：宿主接入方式（两行导入）；原来的三条取舍改写 |
| `ui-development-spec.md` | t02：滚动条 token 一节；t04：浮层合同、关闭原因、尺寸与语调词表、文案属性命名 |
| `design-language.md` 踩过的坑 58 | t02：根因（两套引擎、无层产物）已消除，改写为分层后的判据 |
| 各组件同名 `.md` | t03：路径；t04：属性与事件 |
| `docs/standards/code/components.md` | t03：新增弹出列表零件时用 `MenuRow` 与 `useMenuCascade`，不再手写行 |

## 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| t02 S1 | nb-ui 的样式入口（`@theme`、分层、图标）；playground 改用它；删产物与 `build:css` | nb-ui | nb-ui typecheck、单测、e2e；playground 截图对照改前 |
| t02 S2 | 分层后语义类与原子类的冲突逐处改写（`invalid` 边框等） | nb-ui | 同上；`invalid` 悬停的计算样式断言 |
| t02 S3 | neuro-book 换 Tailwind v4（升级工具加逐处修改），删 `uno.config.ts`；ADR 0023 修订 | neuro-book、ADR | neuro-book typecheck、Vitest、整套 e2e；Lab 全部组件场景改前改后截图对照 |
| t02 S4 | nb-story、dev-panel 改用 nb-ui 入口，删拆分写法 | 两个包的样式入口 | 各自 typecheck、单测、e2e；截图对照 |
| t02 S5 | 滚动条 token 与 `.nb-ui-scrollbar-thin`，滑块几何合一 | nb-ui 与三个宿主的样式 | nb-ui 单测、e2e；Lab 截图两主题明暗 |
| t03 S1 | 搬目录 | 只有移动与导入路径 | nb-ui typecheck、单测 |
| t03 S2 | 级联键盘与外部判定收进 `useMenuCascade` | `popup/` | `popup-lists.spec.ts`、`popup-scroll.spec.ts`；Lab 缩放下的级联尺寸新断言 |
| t03 S3 | `roving.ts`；`Tabs`、`SegmentedControl`、`QuickPick` 改用 | | nb-ui 单测、e2e |
| t03 S4 | `MenuRow` | | 弹出列表两份 e2e；Lab 截图对照 t04 compare |
| t03 S5 | 浮层材质只走 CSS 类（开发者定后） | | Select、ColorSwatches 两主题明暗截图 |
| t04 S0 | 打开未知属性、事件检查并清掉现有报错 | 各宿主 tsconfig 与报错处 | 各宿主 typecheck |
| t04 S1 | 共享词表、文案属性、数据形状 | nb-ui 与全部调用方 | `test:affected --typecheck`；neuro-book 整套 e2e |
| t04 S2 | `ModalShell`、浮层合同、`FloatingWindow` | nb-ui 与全部调用方 | 同上；新增“遮罩上加日志监听不改变关闭行为”的测试 |
| t04 S3 | L07、L14 剩余，`NotificationTone` | | 同上 |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 同一组件在 neuro-book（UnoCSS）与 playground、nb-story（Tailwind）里字号、位移相同 | t02：Lab 与 playground 里读 `IconButton`、`Switch` 滑块、`Select` chevron 的计算样式，e2e 各一条 |
| 页面上只有一个原子 CSS 引擎 | t02：仓库里不再有 `unocss` 依赖；nb-ui 不再导出预编译产物（包导出表的测试） |
| 宿主不需要补丁 | t02：删掉封禁名单与导入顺序约定后 neuro-book 整套 e2e 通过；调用方传的原子类能覆盖组件的语义类（Lab 里一条计算样式断言） |
| 弹出列表键盘行为不变 | t03：现有 `popup-lists.spec.ts`、`popup-scroll.spec.ts`、`lab-nb-ui.e2e.ts` 原样通过 |
| 浮层关闭原因与 `closed` 对每个浮层成立 | t04：一张表驱动测试，每个浮层 × 每种关闭方式 |
| `Dialog` 的关闭不随监听器变化 | t04：挂一个空的 `request-close` 监听，点遮罩仍关闭 |

## 验证

- 每片按上表自跑。每个 Task 收尾时跑 nb-ui 的 typecheck、单测与 e2e，`test:affected --since master --typecheck`，以及 neuro-book 整套 e2e。
- 视觉改动（t02 S3、t03 S4、S5，t04 的遮罩）在 Lab 截两主题明暗，按 w00029 t04 的做法发对照图。
- 审查：t02 与 t03 改前端，派 Sonnet 审实现；t04 的 API 形状交 omp 审计划修订版。
- 留下的未验证边界：旧应用不检查。

## 不做与风险

- **不做**：
  - L11（主题应用流程）、L13 与 L23（数值输入与选项泛型）、L15（Tabs 拆分）、L17（表单合同，w00027 已做）、L19 的单例改造、L20（布局引擎拆包）；
  - 调用方的列表导航零件。
- **风险**：
  - **UnoCSS 到 Tailwind 漏改的写法**：升级工具认不出的（Uno 独有的简写、动态拼接的类名）没有规则就静默失效。靠 Lab 全部场景的改前改后截图对照找出来，逐处改写。
  - **旧应用**：样式失效，开发者定不管。
  - **宿主改回标准 Tailwind 分层后行为变化**：nb-story、dev-panel 自己的原子类进了 layer，原来靠“无层赢”的地方会翻转。按它们自己的 e2e 与截图核对。
  - **t04 的改动面大**：按迁移表逐项列出“按设计变化”的断言，不放宽断言。

## 待开发者确认

1. t02 的做法：评审板上答的是“加前缀”，同日开发者在会话里改定为统一用 Tailwind v4、宿主编译 nb-ui 源码，旧应用不管（见 t02 一节）。
2. 先后：t02、t03 等 w00027 t07 的 S2a、S2b 进 master；t04 等 w00027 t07 做完。
3. t04 不留旧名别名，调用方同一提交改完，靠打开未知属性检查兜住。
4. `Dialog` 拆出 `FloatingWindow`。
5. F43：浮层材质只走 CSS 类（会让 Select 的投影随主题变）。
