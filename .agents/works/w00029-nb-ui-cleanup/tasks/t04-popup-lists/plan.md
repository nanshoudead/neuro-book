# t04 实施计划：弹出列表收成一套，做不抢焦点的候选菜单

## Context

- **为什么做**：nb-ui 的五个弹出列表（`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`）和 Composer 的候选菜单 `PromptMenuPanel` 外框已共用，列表项各画各的：高亮两套（`Menubar` 与 `ContextMenu` 的普通按钮项没有高亮）、选中三套、圆角三种、行高五种；截断高度按 32px 算、`DropdownMenu` 实际 26px；悬浮滑块的模板在 `DropdownMenu` 与 `Select` 里各抄一份；`ContextMenu`、`Menubar` 没有最大高度、不滚动。w00025 t08 的斜杠菜单要一个不抢焦点、贴光标弹出的候选菜单，`PromptMenuPanel` 也不合 nb-ui 浮层的规范（t08 决定 11）。现状见评审板第 1 轮的现状一节（逐项数值在本地 `.local/agent/works/w00029-nb-ui-cleanup/tasks/t04-popup-lists/shots/r1/current-states.md`）。
- **开发者已定**（Task README 决定 1 到 6，评审板 [`artifacts/review/`](artifacts/review/index.html)）：高亮用中性叠色 `--overlay-item-active`；选中用左侧勾选列、底色不变；项圆角 5px（nbook：外框 10px、内边距 4px，同心推出）；一档行高 28px、13px 字（带说明的两行项另算）；长列表最多 8 项半、截在第 9 项中间、空间不够时按可用空间收矮，所有弹出列表共用一份计算；Composer 候选菜单去掉按键提示页脚。
- **开发者已确认要补的**（2026-10-20 会话）：右键菜单与 Menubar 补上最大高度、截断与滑块；新候选菜单补上旧应用 `ReferenceSelectorPopover` 有的定位能力：贴光标弹出、按上下剩余空间翻转、按可用空间收矮（最矮 96px）、左右夹进窗口、窗口缩放与滚动时跟着重新定位。
- **计划审查**：omp（默认模型）13 条，重要 12、建议 1，逐条处理见文末“审查处理”；报告存为 Task 证据 `evidences/plan-review.txt`。
- **约束**：不改 `packages/neuro-book-legacy`；旧名字不留别名（t01 决定 2）；Composer 的候选菜单仍与外框同宽、不跟随光标（[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 的“不做”）。编码由主会话完成；分支 `refactor/w00029-t04-popup-lists`，worktree `.worktree/w00029-t04-popup-lists`，从 master 拉出。

## 关键设计

### 1. 尺寸与圆角的 token（`packages/nb-ui/src/tokens.css`、`src/theme/tokens.ts`、`themes/*/vars.css`、`src/styles.css`）

- 新增 `--menu-item-h`（28px）、`--menu-item-font`（13px）、`--menu-pad`（缺省 `var(--space-3)`），登记进 `src/theme/tokens.ts` 的公开 token 组（主题加载器据此拒绝第三方主题与库内 token 撞名）。
- `--menu-pad` 是浮层外框真正的内边距：`styles.css` 的 `.nb-ui-menu-surface` 写 `padding: var(--menu-pad)`，`--nb-popover-pad` 改取它，同心圆角的公式不变；去掉各组件各自写的 `p-1`、`p-1.5`、`p-[var(--space-3)]`（`useDropdownSurfaceStyle` 的 `popoverClasses`、`Menubar`、`ContextMenuPanel`、`QuickPick`），否则公式按 4px 算、盒子仍是 6px。
- nbook：`--radius-menu` 8px 改 10px，`--menu-pad` 4px，推出项圆角 `10 − 1 − 4 = 5px`。macOS 保留 `--radius-menu` 12px 与缺省内边距 6px，推出 `12 − 1 − 6 = 5px`。
- 项与项之间不留缝（`DropdownMenu` 现在 2px、`Select` 4px，`Menubar`、`ContextMenu` 本来就是 0）。

### 2. 列表项的外观：一份 CSS（`packages/nb-ui/src/styles.css`）

六个列表的项结构差得多（reka 的 `MenuItem`、`SelectItem`、`MenuNodes` 的普通按钮、受控的 `role="option"`），能共用的是“行的外观”，不是带行为的组件。共用件是一组类：

- `.nb-ui-menu-item`：单行时高 `--menu-item-h`；带第二行（`Select` 的 `description`、`QuickPick` 的说明）或允许换行（`DropdownMenu` 的 `wrap`）时 `min-height: --menu-item-h`、由内容撑高。字号 `--menu-item-font`，圆角 `--nb-popover-inner-radius`；`[data-highlighted]` 时底色 `--overlay-item-active`；`[data-disabled]` 降透明度。不写 `:hover` 底色：高亮只认 `data-highlighted` 一个属性，鼠标与键盘不会各亮一项。
- 危险项：`.nb-ui-menu-item-danger` 只给危险色文字与图标，高亮时底色同样是中性叠色；去掉它现在的 `:hover` 与 `.is-active` 红底规则，`DropdownMenu` 的内联危险色一并去掉。
- 子元素：`__check`（左侧 14px 勾选列，选中时画 `i-lucide-check`；整个面板没有可勾选项时不留这一列）、`__icon`、`__label`（单行截断）、`__hint`（快捷键或路径，右对齐、`--text-muted`，放不下时先截它）。
- `.nb-ui-menu-label`（分组标题）、`.nb-ui-menu-separator`（分隔线）。
- `.nb-ui-popover-item` 并进 `.nb-ui-menu-item` 后删掉；删除与所有使用方的迁移在同一片里（切片 S1）。

### 3. 高亮属性由谁挂（`packages/nb-ui/src/components/`）

- reka 的 `MenuItem`（`DropdownMenu` 与 `Menubar` 的一级项）、`SelectItem`：reka 自己在指针移动与聚焦时挂 `data-highlighted`（审查已读实现、并在真实 Chrome 里核实 `Select`）。
- `MenuNodes` 的普通按钮项（`ContextMenu` 全部各级、`DropdownMenu` 与 `Menubar` 的手工级联）：照 reka `MenuItemImpl` 的做法补上状态：`pointermove` 时聚焦这一项（跳过禁用项），`focus` 时挂 `data-highlighted`，`blur` 时去掉。与级联的 `active`（展开了子菜单的父项）分开，两者可以同时成立。
- `QuickPick`、`SuggestionMenu`：受控，给 `activeId` 那一项挂；只在真正的 `mousemove` 时改 `activeId`。

### 4. 各列表改用它（`packages/nb-ui/src/components/`）

- `controls/MenuNodes.vue`：条目改用第 2 节的类，加第 3 节的状态；勾移到左侧勾选列，修好“有快捷键的勾选项丢掉快捷键”。
- `controls/DropdownMenu.vue`：去掉 `compact` 档与 `menuMaxHeight`（最大高度统一由第 5 节决定，见“审查处理”10）；`dropdown-menu.types.ts` 去掉 `active` 字段，选中只用 `type: "radio" | "checkbox"` 加 `checked`。`compact` 的使用方一起改：nb-story `BookFrame.vue` 3 处，新应用 `EditorBreadcrumbs.vue` 2 处、`WorkbenchActivityBar.vue`、`WorkbenchMoveViewMenu.vue`、`ui/menus/TitleActions.vue` 各 1 处；`menuMaxHeight` 的使用方 `EditorBreadcrumbs.vue` 2 处与 Lab 的 long 场景。迁移以真实最多可见项数验证，不以属性从类型里删掉为准（模板里的未知属性不会让类型检查失败）。
- `form/Select.vue`：项改用第 2 节的类，去掉选中项的强调色淡底与中等字重，勾从右侧 `SelectItemIndicator` 挪到左侧勾选列；保留 `description` 的第二行。
- `feedback/ContextMenuPanel.vue`、`controls/Menubar.vue`：接第 5 节的滚动；内边距改由 `--menu-pad` 给。
- `feedback/QuickPick.vue`：项用第 2 节的类，带说明的两行项由内容撑高；外框圆角改取 `--radius-menu`，去掉内联的 14px。

### 5. 滚动：一个组合函数加一个面板零件（`packages/nb-ui/src/composables/`、`components/layout/`）

- `useDropdownFloating`、`useFloatingScrollbar`、`useDropdownTruncatedHeight` 合成 `usePopupScroll(viewport, content)`，三个旧函数与它们的公开导出删掉。
  - **两层高度**：整个浮层先按可用空间夹紧（reka 浮层给的 `--reka-popper-available-height`），扣掉边框、内边距与标题行、加载行这些固定部分，剩下的才给唯一的滚动视口。
  - **截在第 9 个可选项中间**：按真实盒子量，不按固定行高乘：可选项不超过 8 个时视口取自然高度；超过时视口高度取到第 9 个可选项的中点（它前面的分组标题与分隔线照实计入），两行项、换行项用同一算法。可用空间比这更小时以可用空间为准，不再保证截在半项。
  - **跟得上内容变化**：`ResizeObserver` 同时观察视口与内容，过滤、追加候选、同级子菜单换内容后重新量；滑块长度、位置与顶底渐隐随之更新。
  - **拖动滑块**：指针位移与视口高度都用 `getBoundingClientRect` 的同一单位换算，Lab 画布的 CSS `zoom` 下也一一对应。
  - **`reveal(element)`**：键盘移到看不见的项时 `scrollIntoView({block: "nearest"})`，由列表在当前项变化时调用。
  - **所有权**：只操作现有的那一个视口，不另包滚动层；`Select` 仍由 reka 的 `SelectViewport` 滚动、打开时由 reka 滚到选中项，组合函数不在初始化时重置 `scrollTop`。挂载、视口换实例与卸载时各自清理观察器与拖动监听。
- 新内部零件 `layout/PopupScrollbar.vue`：悬浮滑块的模板只写这一份。多级菜单的每一级各有自己的视口、滑块与组合函数实例。不从包入口导出。
- **级联菜单的父级滚动**：父级面板一滚动（滚轮或拖滑块），收起它展开的子菜单，焦点留在父级；子菜单的位置与高度取父级受约束后的真实盒子（`menu-cascade.ts` 的测量对象改为视口）。这是 macOS 菜单的做法，比跟着重新定位简单，也不会出现父项已滚出视口、子菜单还挂着的情况。
- `useDropdownSurfaceStyle`：浮层外观的静态常量（底色、模糊、阴影）查实与 `.nb-ui-popover-surface` 一致后并回 CSS 类，对不上的留给 t05 由开发者定（t05 审查 F04、F05、F10、F43）；动态的部分——经 `NB_POPOVER_Z_INDEX` 注入的层级、reka 的 popper 参数——保留在一个组合函数里，改名为 `usePopoverLayer`。

### 6. 不抢焦点的候选菜单：新组件 `SuggestionMenu`（`packages/nb-ui/src/components/feedback/`）

- **用途**：输入时弹出的候选（Composer 的 `@`、`/`、`$`，编辑器的斜杠菜单）。焦点留在输入处，键盘由宿主转交。
- **数据与 id**：`groups: ReadonlyArray<{id, label?, items: SuggestionMenuItem[]}>`，项：`id`、`label`、`iconClass?`、`hint?`、`disabled?`。项的 `id` 在整个菜单里唯一；组按输入顺序渲染、不合并不重排。每个可选项的 DOM id 由导出的纯函数 `suggestionOptionId(menuId, index)` 给出，`index` 是跨组累计、只数可选项的位置，与宿主键盘移动用的扁平顺序相同；宿主的 `aria-activedescendant` 用同一个函数。`activeId` 不在当前项里时不挂高亮，宿主应清掉 `aria-activedescendant`。
- **其余属性**：`activeId`、`loading`、`loadingText`、`emptyText`、`anchor`、`placement`（`"auto" | "top" | "bottom"`，缺省 `"auto"`）、`matchAnchorWidth`、`id`、`teleportTarget`。事件：`select(id)`、`highlight(id)`（只在鼠标真的移动时发）。插槽 `header`：放标题或搜索框，**可以接收焦点**；“按下鼠标不夺焦点”（`mousedown` 的 `preventDefault`）只加在项列表与非交互区。暴露 `contains(node)`，宿主判断失焦时把浮层算进去（浮层是传送出去的，不在宿主的 DOM 里）。
- **定位用 reka 的 Popover 原语**（`PopoverRoot` 非模态、`PopoverAnchor` 的 `reference`、`PopoverPortal`、`PopoverContent`），与 `DropdownMenu` 走同一条路，而不是直接调 `@floating-ui/dom`：reka 底层就是 floating-ui，现成提供
  - 渲染目标：`useTeleportTarget`（Lab 画布与 `Dialog` 提供的落点，没有时落到 body），层级取第 5 节的 `usePopoverLayer`；
  - Lab 画布 CSS `zoom` 下的锚点换算：沿用 `DropdownMenu` 的 `unscaledRect`，挪成内部工具共用；
  - 翻转与夹紧：`avoidCollisions`、`collisionPadding: 12`；
  - 可用空间：`--reka-popper-available-height`、`--reka-popper-available-width`，外框 `max-height`、`max-width` 取它们（`matchAnchorWidth` 时宽度取锚点宽与可用宽的较小者，项文字与提示截断）；
  - 跟随：`anchor` 是元素时，reka 的 `autoUpdate` 跟随滚动、缩放与锚点尺寸；`anchor` 是虚拟锚点 `{getBoundingClientRect, contextElement}`（光标）时，打开期间 `updatePositionStrategy: "always"`，每帧读一次矩形，光标在同一个输入框里移动也跟得上。关闭与卸载时由 reka 收掉。
  - 打开时 `@open-auto-focus.prevent`、关闭时 `@close-auto-focus.prevent`，不搬动焦点；点外面由宿主决定是否关闭。
- **96px**：`placement: "auto"` 时，偏好的一侧放不下 96px、另一侧更大就翻过去；翻不了（固定方向，或两侧都不够）时以可用空间为准，可以比 96px 矮，不越出边界。
- **外观与滚动**：外框 `.nb-ui-popover-surface .nb-ui-menu-surface`，项用第 2 节的类，滚动用第 5 节；当前项变化时 `reveal`。没有按键提示页脚（决定 6）。
- 同名 `.md` 先写；Lab 场景：贴光标（上方空间不够时往下翻）、与输入框同宽、加载中（已有项照常显示）、没有结果、多组、长列表、窄屏。

### 7. Composer 改用它（`packages/neuro-book/src/plugins/markdown/web/components/prompt/`）

- `PromptEditor.vue` 的候选菜单与输入历史改用 `SuggestionMenu`：锚点是外框元素，`matchAnchorWidth`，`placement` 由现有的 `menuPlacement` 换算（`above` → `top`，`below` → `bottom`，不自动翻转）；标题、项的说明（作 `hint`）、加载中与没有结果的文案照旧由 `prompt-labels.ts` 按界面语言给出。宿主的 `aria-activedescendant` 改用 `suggestionOptionId`。
- 输入历史：搜索框放进 `header` 插槽，它的 ref、Ctrl+R 后的聚焦、方向键、Enter、Escape 与 `combobox`、`aria-controls`、`aria-activedescendant` 由 Composer 持有（与现在相同）；失焦判断用正文区与 `SuggestionMenu.contains` 两边。
- 删掉 `PromptMenuPanel.vue/.md` 与它的 Lab 场景；`prompt-labels.ts` 里只给页脚用的文案一并删掉。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/prompt-editor.md` | 候选菜单没有按键提示一行；外观、截断与滚动按 nb-ui `SuggestionMenu`；输出 10、13 的焦点与 ARIA 写法对齐 `suggestionOptionId` |
| 组件同名 `.md`：`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`、`PromptEditor`；新增 `SuggestionMenu`、`PopupScrollbar` | 高亮、选中、行高、圆角、截断与滚动按本计划；`DropdownMenu` 去掉 `compact`、`menuMaxHeight` 与 `active`；级联菜单的父级滚动即收起子菜单 |
| `packages/nb-ui/docs/design-language.md` | 现行规则与检查清单里挂 `.nb-ui-popover-item`、允许 `:hover` 高亮的条目改为本计划的类与 `data-highlighted`；“踩过的坑”里的历史叙述保留，链接新规则 |
| `packages/nb-ui/docs/ui-development-spec.md` | 只改与本计划直接冲突的条目（下拉、选择器、浮层分级里的行高、截断与 65% 底色等），整份重排留给 t05 |
| `packages/nb-ui/README.md` | 组件清单加 `SuggestionMenu`；去掉三个旧组合函数 |

## 切片

每片改了模板或 CSS 都重建 `dist/nb-ui.css`（`dist-css.test.ts` 会现编并逐字节比较）。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 第 1、2、3 节；第 4 节的菜单一族 | token、列表项的类与高亮状态；`MenuNodes`、`DropdownMenu`、`Menubar`、`ContextMenu` 改用它（含 `compact`、`active`、`menuMaxHeight` 的去掉与 8 处调用方），`.nb-ui-popover-item` 删掉 | nb-ui、neuro-book、nb-story 的 `typecheck` 与 `test`；nb-ui Playwright 验收（新增菜单一族的验收页） |
| S2 | 第 4 节的 `Select`、`QuickPick` | 两者改用列表项的类 | 同 S1 |
| S3 | 第 5 节 | `usePopupScroll`、`PopupScrollbar`、`usePopoverLayer`，接上已有的五个列表；级联父级滚动收起子菜单；三个旧组合函数删掉 | 同 S1 |
| S4 | 第 6 节 | `SuggestionMenu` 与 Lab 场景、验收页 | nb-ui `test` 与 Playwright 验收 |
| S5 | 第 7 节 | Composer 改用它，`PromptMenuPanel` 删掉 | neuro-book `typecheck`、`test`；`lab-markdown.e2e.ts` |
| S6 | 文档与收尾 | Spec 与文档改动表；Sonnet 前端审查与修正；外观对比的 `report` 产物 | `docs:check`、`governance:check`、`test:affected --since master`、neuro-book 整套 e2e |

## 验收映射

布局、尺寸、滚动、真实指针与碰撞都在真实浏览器里验（nb-ui Playwright 验收页，或 neuro-book 的 Lab e2e）；happy-dom 的组件测试只验状态与选择语义。

| 行为 | 由谁覆盖 |
|---|---|
| 六个列表的单行项高 28px、字 13px、圆角 5px；高亮底色一致；选中只画左侧勾；`description`、`wrap`、两行项由内容撑高 | nb-ui Playwright 验收量计算样式与盒子；nbook、macOS × 浅色、深色 × 桌面、390px 的 Lab 截图对照评审板 |
| `ContextMenu` 各级与手工级联的项在悬停与方向键时有高亮，且只亮一项；危险项高亮也是中性叠色 | nb-ui Playwright 验收（真实指针与键盘） |
| 勾选项同时显示快捷键 | `MenuNodes` 组件测试 |
| 可选项超过 8 个时截在第 9 个可选项中间（含分组标题、分隔线、两行项的混合列表）；不超过 8 个时自然高度；空间不够时以可用空间为准 | nb-ui Playwright 验收量视口与第 9 项的盒子 |
| 已溢出的列表追加、过滤候选后滑块与渐隐跟着变；Lab 画布缩放下拖动滑块到两端 | nb-ui Playwright 验收；Lab e2e |
| 键盘移到看不见的项时滚过去；`Select` 打开时停在第 20 个选中项 | nb-ui Playwright 验收 |
| 两级以上的长级联菜单：父级滚轮、拖滑块时子菜单收起；同级换短、长内容 | nb-ui Playwright 验收 |
| `SuggestionMenu` 不抢焦点：点项后焦点仍在输入处；点 `header` 里的搜索框能聚焦与移动光标 | nb-ui Playwright 验收 |
| `SuggestionMenu` 上方放不下时往下翻、左右不出窗口、超宽锚点收窄、可用高度不足 96px 时不越界；窗口缩放、输入框内滚动、光标移动后重新定位；关闭与卸载后不再更新 | nb-ui Playwright 验收（真实布局，虚拟锚点） |
| 键盘滚动时静止的鼠标不抢高亮 | nb-ui Playwright 验收（真实指针停在列表上、按方向键） |
| 多组与重复组标题、禁用项、过滤后下标变化时，`aria-activedescendant` 指向的就是高亮的那一项 | `SuggestionMenu` 组件测试；`suggestionOptionId` 单元测试 |
| Composer：`ui/prompt-editor.md` 输出 5（含 Tab 确认、跳过禁用项、全禁用或没有结果时回车与 Tab 交还正文、加载中保留已有项）、10（Ctrl+R 后直接输入过滤、方向键、确认回正文、Escape 不改正文、点搜索框）、12、13，验收场景 4；没有页脚 | `lab-markdown.e2e.ts` 补用例（真实 Chrome）；`PromptEditor.dom.test.ts` 补状态语义 |

## 验证

- 每片的命令见切片表；收口跑 `bun run test:affected --since master` 与 neuro-book 整套 e2e（e2e 前停掉多余的开发服务）。
- 真实浏览器：上表的 nb-ui Playwright 验收页与 Lab e2e；Lab 里逐个打开六个列表与新候选菜单，按 nbook、macOS × 浅色、深色 × 桌面、390px 截图，改前改后做成 `report` 产物发给开发者。
- 留下的未验证边界：编辑器斜杠菜单接上 `SuggestionMenu` 归 w00025 t08，这里只在 Lab 与验收页里验贴光标的定位；产品页里 `Dialog` 上的候选菜单层级在 Composer 落进对话框之前只在验收页里验。

## 不做与风险

- 不做：编辑器的斜杠菜单本身（w00025 t08）；nb-ui 规范文档的整份重排（t05）；`ScrollArea` 与 `OverlayScrollbar` 两套常驻滚动组件的合并（不是弹出列表，另议）；历史搜索框的输入法组字处理（现在就没有，不是本次的回归）。
- 风险：`DropdownMenu` 去掉 `compact` 后，nb-story 顶栏与新应用里 5 处菜单的项变高 4px，`menuMaxHeight` 320px 的面包屑下拉变成最多 8 项半；在相关 e2e 与截图里核对。
- 风险：按真实盒子量截断高度要在打开后量一次，第一帧可能是自然高度；用 reka 浮层的定位完成时机（或 `ResizeObserver` 的首次回调）量，并在验收里看打开过程有没有跳动。

## 开发者已确认（2026-10-20）

1. 新组件叫 `SuggestionMenu`（“输入时弹出的候选”，与 `QuickPick`、`DropdownMenu` 分开）。
2. `DropdownMenu` 去掉 `compact` 档与项的 `active` 字段。
3. 候选菜单的定位用 floating-ui。计划审查后改为经 reka 的 Popover 原语使用它（reka 底层就是 floating-ui），不直接调 `@floating-ui/dom`、不另加依赖；**待开发者确认这一改动**。

## 审查处理

omp 计划审查 13 条（报告 `evidences/plan-review.txt`），全部成立，按条改进计划：

| 条 | 处理 |
|---|---|
| 1 普通按钮项不产生高亮 | 第 3 节：`MenuNodes` 的普通按钮项照 reka 补上指针移动聚焦、聚焦挂属性；验收分根级与子级 |
| 2 固定乘法兑现不了混合列表的半项；没分外框与视口高度 | 第 5 节：两层高度；按真实盒子量第 9 个可选项的中点；空间不够时以可用空间为准 |
| 3 `autoUpdate` 不跟随返回矩形的函数 | 第 6 节：虚拟锚点带 `contextElement`，打开期间每帧更新；清理由 reka 负责 |
| 4 没定渲染目标、坐标系与层级 | 第 6 节：走 reka Popover，与 `DropdownMenu` 同一套渲染目标、层级与 Lab 缩放换算 |
| 5 `shift` 不能缩窄，96px 下限可能越界 | 第 6 节：最大宽高取可用空间；96px 只作翻转的门槛，翻不了时以边界为准 |
| 6 `description` 与 `wrap` 不能锁死 28px | 第 2 节：单行固定 28px，带第二行或换行的项最小 28px、由内容撑高 |
| 7 历史搜索框的焦点与 ARIA 迁移 | 第 6、7 节：`header` 可聚焦，`preventDefault` 只在项列表；`contains` 判失焦；验收补输出 10、12 |
| 8 父级滚动后级联菜单的位置 | 第 5 节：父级一滚动就收起子菜单；每级各自一套滚动；测量取视口 |
| 9 分组后的 option id | 第 6 节：`suggestionOptionId`、跨组累计只数可选项、组不重排 |
| 10 `compact` 漏了新应用 5 处；`menuMaxHeight` 绕过 8 项半 | 第 4 节：8 处调用方列全；`menuMaxHeight` 去掉，迁移以最多可见项数验证 |
| 11 内容变化、缩放拖动与 `Select` 初始化时序 | 第 5 节：观察内容、同一单位换算、只操作现有视口、不重置 `scrollTop` |
| 12 切片不独立可验，布局交给了 happy-dom，Composer 指错测试 | 切片重排、每片重建产物；布局全部进真实浏览器；Composer 改为 `lab-markdown.e2e.ts`；补主题与窄屏矩阵 |
| 13 新 token 没登记，`design-language.md` 漏改 | 第 1 节登记进 `tokens.ts`；文档改动表加 `design-language.md` |

另两处补充核实：浮层的真实内边距要迁到 `--menu-pad`（第 1 节）；危险项的红底规则去掉、高亮同样用中性叠色（第 2 节）。
