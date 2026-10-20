# t04 实施计划：弹出列表收成一套，做不抢焦点的候选菜单

## Context

- **为什么做**：nb-ui 的五个弹出列表（`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`）和 Composer 的候选菜单 `PromptMenuPanel` 外框已共用，列表项各画各的：高亮两套（`Menubar`、`ContextMenu` 没有高亮）、选中三套、圆角三种、行高五种；截断高度按 32px 算、`DropdownMenu` 实际 26px；悬浮滑块的模板在 `DropdownMenu` 与 `Select` 里各抄一份；`ContextMenu`、`Menubar` 没有最大高度、不滚动。w00025 t08 的斜杠菜单要一个不抢焦点、贴光标弹出的候选菜单，`PromptMenuPanel` 也不合 nb-ui 浮层的规范（t08 决定 11）。现状调研见评审板第 1 轮的现状一节（逐项数值在本地 `.local/agent/works/w00029-nb-ui-cleanup/tasks/t04-popup-lists/shots/r1/current-states.md`）。
- **开发者已定**（Task README 决定 1 到 6，评审板 [`artifacts/review/`](artifacts/review/index.html)）：高亮用中性叠色 `--overlay-item-active`；选中用左侧勾选列、底色不变；项圆角 5px（nbook：外框 10px、内边距 4px，同心推出）；一档行高 28px、13px 字（带说明的两行项另算）；长列表最多 8 项半、截在第 9 项中间、空间不够时按可用空间收矮，所有弹出列表共用一份计算；Composer 候选菜单去掉按键提示页脚。
- **开发者已确认要补的**（2026-10-20 会话）：右键菜单与 Menubar 补上最大高度、截断与滑块；新候选菜单补上旧应用 `ReferenceSelectorPopover` 有的定位能力：贴光标弹出、按上下剩余空间翻转、按可用空间收矮（最矮 96px）、左右夹进窗口、窗口缩放与滚动时跟着重新定位。
- **约束**：不改 `packages/neuro-book-legacy`；旧名字不留别名（t01 决定 2）；Composer 的候选菜单仍与外框同宽、不跟随光标（[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 的“不做”）。编码由主会话完成；分支 `refactor/w00029-t04-popup-lists`，worktree `.worktree/w00029-t04-popup-lists`，从 master 拉出。

## 关键设计

### 1. 尺寸与圆角的 token（`packages/nb-ui/src/tokens.css`、`themes/*/vars.css`、`src/styles.css`）

- 新增 `--menu-item-h`（28px）、`--menu-item-font`（13px）、`--menu-pad`（缺省 `var(--space-3)`）。`styles.css` 里 `--nb-popover-pad` 改取 `--menu-pad`，项圆角的同心公式（`--nb-popover-inner-radius`）不变。
- nbook：`--radius-menu` 8px 改 10px，`--menu-pad` 4px，推出项圆角 5px。macOS 主题保留自己的 `--radius-menu` 12px 与缺省内边距，同一公式推出 5px。
- 截断高度改由这两个 token 推出：`8.5 × --menu-item-h + 2 × --menu-pad`，项与项之间不再留缝（`DropdownMenu` 现在 2px、`Select` 4px，`Menubar`、`ContextMenu` 本来就是 0），截断位置才对得上真实行高。

### 2. 列表项的外观：一份 CSS（`packages/nb-ui/src/styles.css`）

六个列表的项结构差得多（reka 的 `MenuItem`、`SelectItem`、受控的 `role="option"`），能共用的是“行的外观”，不是带行为的组件（搭稿时的发现 3）。所以共用件是一组类：

- `.nb-ui-menu-item`：高 `--menu-item-h`、字号 `--menu-item-font`、圆角 `--nb-popover-inner-radius`；`[data-highlighted]` 时底色 `--overlay-item-active`；`[data-disabled]` 降透明度；配 `.nb-ui-menu-item-danger`（已有）画危险项。高亮只认 `data-highlighted` 一个属性：reka 的菜单项、选项自己会挂；受控列表（`QuickPick`、候选菜单）给当前项挂上。不写 `:hover` 底色，免得鼠标与键盘各亮一项。
- 子元素：`__check`（左侧 14px 勾选列，选中时画 `i-lucide-check`，整组没有可勾选项时不留这一列）、`__icon`、`__label`（截断）、`__hint`（快捷键或路径，右对齐、`--text-muted`）。
- `.nb-ui-menu-label`（分组标题）、`.nb-ui-menu-separator`（分隔线）。
- 复用：现有的 `.nb-ui-popover-surface`、`.nb-ui-menu-surface`、`.nb-ui-popover-item`（后者并进 `.nb-ui-menu-item`，删掉）。

### 3. 各列表改用它（`packages/nb-ui/src/components/`）

- `controls/MenuNodes.vue`（`DropdownMenu`、`Menubar`、`ContextMenu` 共用的一级条目）：条目改用第 2 节的类；勾移到左侧勾选列，修好“有快捷键的勾选项丢掉快捷键”（发现 4）。`Menubar` 与 `ContextMenu` 由此有了高亮。
- `controls/DropdownMenu.vue`：去掉内联的危险色与 `compact` 档（一档行高；nb-story 的 `BookFrame.vue` 三处与 Lab 场景去掉 `compact`）；`dropdown-menu.types.ts` 去掉 `active` 字段，选中只用 `type: "radio" | "checkbox"` 加 `checked`（产品里没有用 `active` 的地方）。
- `form/Select.vue`：项改用第 2 节的类，去掉选中项的强调色淡底与中等字重，勾从右侧 `SelectItemIndicator` 挪到左侧勾选列；行高随 token，不再由内容撑开（选中项比别的高 1px 的问题随之没了）。
- `feedback/ContextMenuPanel.vue`、`controls/Menubar.vue` 的子菜单内容：接上第 4 节的滚动件。
- `feedback/QuickPick.vue`：单行项用第 2 节的类；带说明的两行项保持现在的高度；外框圆角改取 `--radius-menu`，去掉内联的 14px。

### 4. 滚动：一个组合函数加一个滑块组件（`packages/nb-ui/src/composables/`、`components/layout/`）

- `useDropdownFloating`、`useFloatingScrollbar`、`useDropdownTruncatedHeight` 合成 `usePopupScroll(viewport, {maxRows?})`：给出截断后的最大高度（第 1 节的公式，再与可用空间取小）、滑块的位置与长度、顶底渐隐的类、`reveal(element)`（键盘移到看不见的项时 `scrollIntoView({block: "nearest"})`）。`useDropdownSurfaceStyle` 里写死的浮层外观常量查实后并回 CSS 类（t05 审查 F10、F43 指出它与 CSS 类是两个来源）；查实不能并的，留到 t05 由开发者定。
- 新内部件 `layout/PopupScrollbar.vue`：悬浮滑块的模板只写这一份，`DropdownMenu`、`Select`、`ContextMenu`、`Menubar`、`QuickPick`、候选菜单都用它。不从包入口导出。
- 名字里的 `Dropdown` 是 t03 留下的（三个组合函数为 `Select` 与 `DropdownMenu` 共用），这里随合并一起改掉。

### 5. 不抢焦点的候选菜单：新组件 `SuggestionMenu`（`packages/nb-ui/src/components/feedback/`）

- 用途：输入时弹出的候选（Composer 的 `@`、`/`、`$`，编辑器的斜杠菜单）。焦点始终留在输入处：菜单不接焦点（按下鼠标 `preventDefault`），键盘由宿主转交。
- 属性：`groups: ReadonlyArray<{id, label?, items: SuggestionMenuItem[]}>`（项：`id`、`label`、`iconClass?`、`hint?`、`disabled?`）、`activeId`、`loading`、`emptyText`、`anchor`（元素，或返回矩形的函数——光标位置）、`placement`（`"auto" | "top" | "bottom"`，缺省 `"auto"`）、`matchAnchorWidth`、`id`（给宿主的 `aria-controls`、`aria-activedescendant` 用，每项的 id 为 `${id}-${index}`）。事件：`select(id)`、`highlight(id)`（只在鼠标真的移动时发，键盘滚动带来的 `mouseenter` 不算）。
- 定位用 `@floating-ui/dom`（reka 已经依赖它，1.8.0；nb-ui 的 `package.json` 显式加上）：`computePosition` 加 `flip`、`shift`（左右夹进窗口，留 12px）、`size`（按可用空间收矮，最矮 96px），`autoUpdate` 负责窗口缩放、滚动与锚点变化时重新定位。光标位置用 floating-ui 的虚拟元素。按实施前先做技术选型的约定，不手写这套计算。
- 外观与滚动：外框 `.nb-ui-popover-surface .nb-ui-menu-surface`，项用第 2 节的类，滚动用第 4 节；当前项变化时 `reveal`。没有按键提示页脚（决定 6）。
- 同名 `.md` 先写；Lab 场景：贴光标（上方空间不够时往下翻）、与输入框同宽、加载中、没有结果、长列表、窄屏。

### 6. Composer 改用它（`packages/neuro-book/src/plugins/markdown/web/components/prompt/`）

- `PromptEditor.vue` 的候选菜单与输入历史改用 `SuggestionMenu`：锚点是外框元素，`matchAnchorWidth`，`placement` 由现有的 `menuPlacement` 换算（`above` → `top`，`below` → `bottom`，不自动翻转，保持现在的行为）。输入历史顶部的搜索框放在菜单外框上方的插槽里，`SuggestionMenu` 留一个 `header` 插槽。
- 删掉 `PromptMenuPanel.vue/.md` 与它的 Lab 场景；`prompt-labels.ts` 里只给页脚用的文案一并删掉。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/prompt-editor.md` | 候选菜单没有按键提示一行；外观与滚动按 nb-ui `SuggestionMenu` |
| 组件同名 `.md`：`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`、`PromptEditor`；新增 `SuggestionMenu`、`PopupScrollbar` | 高亮、选中、行高、圆角、截断与滚动按本计划；`DropdownMenu` 去掉 `compact` 与 `active` |
| `packages/nb-ui/docs/ui-development-spec.md` | 只改与本计划直接冲突的条目（下拉、选择器、浮层分级里的行高、截断与 65% 底色等），整份重排留给 t05 |
| `packages/nb-ui/README.md` | 组件清单加 `SuggestionMenu` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 第 1、2 节 | token 与列表项的类，`dist/nb-ui.css` 重建 | nb-ui `typecheck`、`test` |
| S2 | 第 3 节 | 五个列表改用列表项的类；`compact`、`active` 去掉，nb-story 与 Lab 跟着改 | nb-ui、neuro-book、nb-story 的 `typecheck` 与 `test`；Lab 截图对照 |
| S3 | 第 4 节 | `usePopupScroll`、`PopupScrollbar`，六处接上；三个旧组合函数删掉 | 同 S2；nb-ui Playwright 验收 |
| S4 | 第 5 节 | `SuggestionMenu` 与 Lab 场景、验收页 | nb-ui `test` 与 Playwright 验收 |
| S5 | 第 6 节 | Composer 改用它，`PromptMenuPanel` 删掉 | neuro-book `typecheck`、`test`；`markdown-input`、`lab-*` 相关 e2e |
| S6 | 文档 | Spec 与文档改动表；Sonnet 前端审查与修正；评审板发外观对比报告 | `docs:check`、`governance:check`、`test:affected --since master` |

## 验收映射

| 行为 | 由谁覆盖 |
|---|---|
| 六个列表的项在 nbook 下高 28px、字 13px、圆角 5px；高亮底色一致；选中只画左侧勾 | nb-ui 组件测试读计算样式；Lab 截图（`lab:shot`）逐个对照评审板 |
| `Menubar`、`ContextMenu` 的项在悬停与方向键时有高亮 | nb-ui Playwright 验收（真实指针与键盘） |
| 勾选项同时显示快捷键 | `MenuNodes` 的组件测试 |
| 超过 8 项半时截在第 9 项中间、可滚动、有滑块；空间不够时收矮 | nb-ui Playwright 验收量高度；`usePopupScroll` 的单元测试 |
| 键盘移到看不见的项时滚过去 | 各列表的组件测试 |
| `SuggestionMenu` 不抢焦点：点项后焦点仍在输入处 | nb-ui Playwright 验收 |
| `SuggestionMenu` 上方放不下时往下翻、左右不出窗口、窗口缩放后重新定位 | nb-ui Playwright 验收（真实布局） |
| 键盘滚动时静止的鼠标不抢高亮 | `SuggestionMenu` 组件测试（只有 `mousemove` 改高亮） |
| Composer 的候选菜单行为不变（`ui/prompt-editor.md` 输出 5、13，验收 4），没有页脚 | `PromptEditor.dom.test.ts`、`markdown-input.e2e.ts` |

## 验证

- 每片的命令见切片表；收口跑 `bun run test:affected --since master` 与 neuro-book 整套 e2e（e2e 前停掉多余的开发服务）。
- 真实浏览器：nb-ui Playwright 验收页量行高、截断与翻转；Lab 里逐个打开六个列表与新候选菜单截图，改前改后做成 `report` 产物发给开发者。
- 留下的未验证边界：编辑器斜杠菜单接上 `SuggestionMenu` 归 w00025 t08，这里只在 Lab 里验证贴光标的定位。

## 不做与风险

- 不做：编辑器的斜杠菜单本身（w00025 t08）；nb-ui 规范文档的整份重排（t05）；`ScrollArea` 与 `OverlayScrollbar` 两套常驻滚动组件的合并（不是弹出列表，另议）。
- 风险：reka 的 `Select` 只在聚焦时挂 `data-highlighted`，键盘与鼠标的行为不变，只换外观；若某个 reka 原语不肯让行高由 token 决定，在该组件的同名 `.md` 写明并找开发者。
- 风险：`DropdownMenu` 去掉 `compact` 后 nb-story 顶栏的两个菜单变高 4px；在 nb-story 的 e2e 与截图里核对。

## 开发者已确认（2026-10-20）

1. 新组件叫 `SuggestionMenu`（“输入时弹出的候选”，与 `QuickPick`、`DropdownMenu` 分开）。
2. `DropdownMenu` 去掉 `compact` 档与项的 `active` 字段。
3. 候选菜单的定位用 `@floating-ui/dom`，在 nb-ui 里显式声明依赖。
