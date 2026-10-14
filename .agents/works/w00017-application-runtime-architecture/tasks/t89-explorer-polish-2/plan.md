# t89 实施计划：内联输入、选中样式、悬停滚动条与标题动作

## Context

- t86 验收时开发者提了三条，评审板 v1（[review](artifacts/review/index.html)）2026-10-14 三题都取推荐，决定见 [README](README.md#决定)。期间报的三个 bug 已在分支上修好（README“当前状态”）。
- VS Code 的参照数值见 [vscode-research.md](vscode-research.md)。
- 工作位置：`.worktree/w00017-t89-explorer-polish-2`，分支 `feat/w00017-t89-explorer-polish-2`；每片自跑验证后提交，只暂存本片文件。

## 关键设计

### 1. 内联输入（`packages/neuro-book/src/plugins/explorer/web/components/ExplorerRow.vue`）

- 编辑行与普通行同一几何（左右各让 6px 的圆角块），铺选中底色。
- 输入框仍是 nb-ui `FormInput`（不手写原生控件），在行里用作用域样式收紧：高 22px（行高减 4）、6px 圆角、1px `--focus-outline` 描边、无外扩光环与投影、文字与行一致（13px）。不给 `FormInput` 加变体：这个外观只在树里用，等第二个使用者出现再提到 nb-ui。
- 报错：贴在输入框下沿、左右与输入框对齐的一条，浅错误底（`--status-danger` 12% 混面板底）、错误色字与 1px 错误色框，下两角圆；输入框描边换成错误色。

### 2. 选中样式（`ExplorerRow.vue`、`ExplorerTree.vue`）

- 选中、悬停的颜色从模板里的工具类搬到作用域样式，按 `aria-selected` 与树是否有焦点（`[data-explorer-tree]:focus-within`）区分：有焦点 `--accent-bg` 底、`--accent-text` 字；没焦点灰底（`--text-main` 混 9%，比 `--bg-hover` 深一档）、普通字色。不新增主题 token；明暗两态核对对比度。
- 关掉编辑器不动选中（现状即如此，只改样子）。

### 3. 悬停滚动条（nb-ui 新组件 `OverlayScrollbar`）

- `packages/nb-ui/src/components/layout/OverlayScrollbar.vue` + 同名 `.md`：挂到调用方给的滚动元素上（`target: HTMLElement | null`），自己作为它的兄弟元素、绝对定位在父元素右缘；滚动元素加 `nb-ui-scrollbar-none`（隐藏原生滚动条，不占宽度）。
- 显示：鼠标在父元素里、滚动中（最后一次 `scroll` 之后 500ms 内）、拖动滑块时可见；淡入 100ms，离开后等 500ms 再 800ms 淡出；内容不溢出时不画；系统减少动画时不过渡。
- 外观：滑块 8px 宽、圆角、`--text-main` 32% 混透明，悬停 45%、拖动 55%；没有轨道底色。拖滑块按比例滚动；点滑块以外的轨道按一页滚动。
- 几何用 `ResizeObserver`（滚动元素与内容）与 `scroll` 事件同步，跟 `useFloatingScrollbar` 同一算法，抽成纯函数测。
- 使用方：资源管理器的树（`ExplorerTree.vue`：去掉 `scrollbar-gutter: stable` 与 `scrollbar-width: thin`）；工作台视图外框 `WorkbenchViewFrame.vue` 的 `scroll` 布局（换掉 Reka `ScrollArea`，滚动元素仍是外框内的一个 div）。`ScrollArea` 本身不动（设置窗口等仍用）。
- nb-ui 规范 `ui-development-spec.md` 第 15 条补“工作台视图用叠加的悬停滚动条（OverlayScrollbar）”，并说明与 `scrollbar-gutter: stable` 规则的分工。

### 4. 标题动作随鼠标显示（`packages/neuro-book/src/plugins/workbench/web/components/`）

- 三处位置：ToolPart 容器标题行（single，`WorkbenchToolPartHost.vue` 的 `actions` 插槽，范围是整个 ToolPart）、面板标签带旁的工具区（`WorkbenchShell.vue`，范围是整个面板）、multiple 时各视图标题行（`WorkbenchViewInstances.vue`，范围是该视图的窗格）。
- 范围元素加 `data-hover-actions-scope`，动作区加 `data-hover-actions`；共用样式：动作区 `opacity: 0`，范围 `:hover`、`:focus-within`、或动作区里有展开的菜单（`[aria-expanded="true"]`）时 `opacity: 1`；淡入淡出 100ms。用透明度不用 `display`：不让标题行宽度跳、按钮仍能被 Tab 到。`@media (hover: none)` 时一直显示。
- 面板与 ToolPart 的框架按钮（最大化、关闭面板等）不在动作区里，不受影响。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | “行的样子”：选中分有焦点与无焦点两种；新增“内联输入”一条；树的滚动条见 views 新输出 |
| `docs/specs/workbench/views.md` | 输出 10 补显示规则；新增输出 12“滚动条”；验收补一条 |
| `packages/nb-ui/docs/ui-development-spec.md` | 第 15 条补悬停滚动条 |
| 组件 `.md` | `ExplorerRow.md`、`ExplorerTree.md`、`WorkbenchViewFrame.md`、`WorkbenchToolPartHost.md`、`WorkbenchViewInstances.md` 按改动同步；新建 `OverlayScrollbar.md` |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | Spec 与规范 | `docs:check`、`governance:check` |
| S1 | 内联输入与选中样式 | neuro-book typecheck、explorer 组件测试、`files-explorer.e2e.ts` |
| S2 | `OverlayScrollbar`（nb-ui，含 Lab 场景）与两处使用 | nb-ui 测试与 typecheck、`lab:shot`、`workbench-views.e2e.ts`、`files-explorer.e2e.ts` |
| S3 | 标题动作随鼠标显示 | `workbench-views.e2e.ts`、`files-explorer.e2e.ts`、`workbench-shell.e2e.ts` |
| S4 | 收口截图（nbook、macos × 明暗）与 `test:affected --typecheck` | — |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 内联输入的样子与报错位置 | `files-explorer.e2e.ts` 新增：输入框高度小于行、无外扩阴影，报错条在输入框正下方且左右对齐 |
| 选中在树失焦后变灰 | `files-explorer.e2e.ts`：点选后读背景色，焦点移到编辑区后背景色变为灰底 |
| 滑块显示时机、几何与拖动 | `OverlayScrollbar` 几何纯函数单测；`workbench-views.e2e.ts` / `files-explorer.e2e.ts`：鼠标在外不可见、移入可见、拖滑块滚动、不占宽度 |
| 标题动作随鼠标显示 | `files-explorer.e2e.ts`：鼠标在外时动作透明、移入或 Tab 进入后可见、菜单打开时保持可见 |

## 不做与风险

- 不改 Reka `ScrollArea` 与弹出列表的滚动条；编辑器正文的滚动条不变。
- 风险：e2e 里点标题动作之前要先让鼠标进入视图——现有用例直接 `click()`，Playwright 会先移动鼠标到按钮上，按钮在视图里，`:hover` 成立；透明度为 0 的元素 Playwright 仍视为可见可点，现有断言不受影响。
