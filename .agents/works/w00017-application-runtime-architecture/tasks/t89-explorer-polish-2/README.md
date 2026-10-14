---
schema: nbook.task/v2
taskId: t89-explorer-polish-2
status: active
updated: 2026-10-14
---

# 资源管理器打磨（二）：内联输入、行样式与滚动条

## 目标与范围

t86 验收时开发者新提的三条：新建与改名的内联输入框样式；选中与悬停的行样式（右端被裁、关闭编辑器后的选中态）；滚动条半透明、只在鼠标进入时显示，视图标题的动作随鼠标显示。之后开发者又报了两个 bug：侧栏从收起状态往外拉时活动栏与侧栏要等松手才相连；视图标题的“移动到”菜单被资源管理器选中的行盖住。

执行位置：`.worktree/w00017-t89-explorer-polish-2`，分支 `feat/w00017-t89-explorer-polish-2`。VS Code 的做法（sonnet 子代理读 1.141.1 源码）：[vscode-research.md](vscode-research.md)。

合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)；滚动条按评审结果改 [nb-ui 开发规范](../../../../../packages/nb-ui/docs/ui-development-spec.md) 的滚动条一条。

## 当前状态

- 2026-10-14 已修三个 bug（分支上，各带 e2e，均做过去掉修复后测试失败的核对）：
  - 行的选中与悬停底色右端被滚动条槽位裁掉：行左右各让 6px 又是 100% 宽，改为宽度由左右两边定（`c7cf1b6a0`）。
  - 侧栏从零拉出时活动栏与侧栏松手才相连：相连按已落账的宽度判断，改为拖动中已拉出的部件按有宽度算；`ui/workbench-shell.md` 输出 38 补一句（`4b57e56b1`）。
  - “移动到”菜单被选中的行盖住：t86 给行容器的 `z-index: 1` 越出了树，树改为自成层叠上下文（`5c22c4ec1`）。
- 评审板第一轮（[review](artifacts/review/index.html) v1）：输入框样式、选中与关掉文件之后、悬停滚动条与标题动作的范围三道题，开发者都取推荐（见“决定”）。
- 2026-10-14 实施（[plan.md](plan.md)，S0–S4，分支上）：
  - S0 Spec（`e93e41c40`、`184b1d6d0`、`d6dc180ff`）：files-explorer“行的样子”的选中两种样子、新增“内联输入”“滚动条”两条与验收 29；views 输出 10 的显示规则、新增输出 12“滚动条”与验收 9；nb-ui 规范第 15 条加场景 C（工作台视图用叠加的悬停滚动条）。
  - S1（`26406d9f5`、`93d5ad772`）：输入行铺选中底色，输入框 22px、6px 圆角、1px 焦点色描边、无光环，报错贴在输入框下沿；选中按 `:focus-within` 分强调色与灰底，灰底是悬停色再混 8% 文字色（只混文字色时与悬停一样深，收口截图里看出来后改）。顺带修了编辑行同时带 `relative` 与 `absolute`、宽度按整行算的问题。
  - S2（`d8bd84369`、`69965b013`）：nb-ui 新组件 `OverlayScrollbar`（几何是纯函数并有单测，Lab 场景与 `lab:shot` 无问题）；资源管理器的树与视图外框的 `scroll` 布局改用它，外框不再用 Reka `ScrollArea`。
  - S3（`b8a2a722b`）：视图标题动作在三处位置（ToolPart 标题行、面板标签带旁、各视图标题行）随鼠标显示，规则在 `hover-actions.css`。
  - 收尾修正（`fe3cffcba`）：nb-ui 的 token 扫描要求动效时长走 `--motion-*`，新增 `--motion-reveal-in/hold/out`（100/500/800ms，减少动画时归零），`dist/nb-ui.css` 重新生成。
  - 验证：nb-ui 581 例、dev-panel 416 例、neuro-book Bun 1141 例与 Vitest 209 例通过；vue-tsc 两项 0 错误；`files-explorer.e2e.ts` 与 `workbench-views.e2e.ts` 44 例通过，`workbench-shell`、`workbench-dnd` 各一例失败是 Lab 首屏超时与 Chrome 崩溃，单独重跑通过；`docs:check`、`governance:check` 0 失败。neuro-book 的 `tsc` 有 5 个错误，不是本 Task 引入的：w00022 给 dev-panel 加的 `@types/jsdom`（`ca27fa192`）装进了主仓库的 `node_modules`，vitest 的可选类型声明 import `jsdom` 时沿父目录找到它，带进 DOM 库，`WebSocket`、`Blob` 的类型与 Bun 的冲突；master 主工作区同样报这 5 个，worktree 在主仓库目录之下，所以也受影响。收口截图（nbook、macos × 明暗；上排改名报错，下排关掉文件后的灰底选中与悬停时的滑块、标题动作）：[t89-final-themes.webp](evidences/t89-final-themes.webp)。
- 2026-10-14 页面验收第一轮，开发者提两条，已改（分支上）：
  - 滚动条太宽：滑块由 8px 收窄到 6px，与 nb-ui `ScrollArea` 的滑块同宽，views 输出 12 随之改（`1e2226d30`）。开发者问 nb-ui 是否已有滚动条：有 `ScrollArea`（Reka），但它自建视口、把内容包进去，资源管理器的树本身是滚动元素又是带焦点的 `role="tree"`，虚拟列表直接读写它的 `scrollTop`，所以另做了接到已有滚动元素上的 `OverlayScrollbar`；nbdev 页面用的是 `dev-panel/src/web/app.css` 里的原生细滚动条样式，不是 nb-ui 组件。
  - 侧栏往零拖时活动栏要等松手才变回四角都圆的独立卡片：卡片按拖动预览算时只补了“拉出”，没补“拖到零”；补上，`ui/workbench-shell.md` 输出 38 那句改为两个方向都不等松手，e2e 加“拖到零、松手前活动栏已不相连”的断言，去掉修复时失败（`78baf37d4`）。验证：`workbench-views`、`files-explorer`、`workbench-shell` 三个 e2e 文件 58 例通过（Lab 两例首屏超时，单独重跑通过），nb-ui 581 例、外壳布局组件测试通过，vue-tsc web 0 错误，`docs:check`、`governance:check` 0 失败。
- neuro-book `tsc` 的 5 个错误开发者已交给 w00022 处理。

## 决定

开发者 2026-10-14 在评审板 v1 上答（都取推荐）：

1. r1-input = thin：新建与改名的输入框收在行里——整行铺选中底色，输入框比行矮 4px（22px）、6px 圆角、1px 焦点色描边，没有外扩光环与投影；报错是贴在输入框下面、与输入框等宽的一条浅红底红字红框。
2. r1-select = gray：选中保留（关掉编辑器不清选中）；焦点在树里时浅蓝底蓝字，焦点不在树里时灰底、普通字色，灰底比悬停深一档。
3. r1-hover = views：所有视图（侧栏、右栏、面板里的视图）用叠加的悬停滚动条（不占宽度、8px 半透明滑块（验收时改为 6px）、无轨道；鼠标进入视图、滚动或拖滑块时 100ms 淡入，离开 500ms 后 800ms 淡出）；视图标题的动作（含“移动到”）在鼠标位于视图上或焦点在视图里时出现。编辑器正文与弹出列表不变；nb-ui 规范的滚动条一条随之改。

## 下一步

验收第一轮的两条已改，等开发者再看一眼；开发者已同意验收通过后合入 master、push，并收尾 Work（改写 README 过时处、标完成、删 t89 与 t90 的 worktree 和分支）。
