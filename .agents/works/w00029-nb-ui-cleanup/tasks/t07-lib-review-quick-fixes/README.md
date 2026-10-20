---
schema: nbook.task/v2
taskId: t07-lib-review-quick-fixes
status: active
updated: 2026-10-20
---

# nb-ui 库审查的小修：遮罩变量、抽屉层级、删掉没用的导出

## 目标与范围

按 t05/evidences/lib-review.txt 的整改顺序第 1 步：修 L09（--overlay-scrim 没有声明）并让 token 检查覆盖“用到的变量必须有声明”；L07 里 Drawer 补浮层层级；L02、L14 里没人用的代码、导出与依赖删掉。不改公开 API 的形状。在 t04 决定 8、9 那一轮合入 master 后开工。

合同：组件契约见 `packages/nb-ui/src/components/feedback/Drawer.md`、`AlertDialog.md`；滚动条槽位的规则改在 `packages/nb-ui/docs/ui-development-spec.md` 的滚动条一节（库不再给 `html` 写全局 `scrollbar-gutter`，整页会滚的宿主自己声明）。其余条目是删除零使用方的代码，行为合同未变。

## 做了什么

分支 `fix/w00029-t07-lib-quick-fixes`，变基后快进合入 master，两个提交：

1. **L09、L07**（93a833251）
   - AlertDialog 与 Drawer 的遮罩改用与 Dialog 相同的 `--overlay-bg`（原来引用从未声明的 `--overlay-scrim`，背景色无效，只有模糊、不压暗）。
   - Badge 的 `--space-1-5`、`--weight-semibold` 不是登记的 token，换成等值的 `--space-3`（6px）、`--weight-strong`（600）；Lab 的 SurfaceTierDemo 同样的 `--weight-semibold` 一并换掉。
   - `token-consumption.test.ts` 加规则 7：组件与 `styles.css` 里 `var(--x)` 的 x 必须在 `tokens.css`、`styles.css`、配色契约或组件自己（样式、任意属性、`:style` 键、`style.setProperty`）里有声明；宿主可选的覆盖点（`--nb-splitter-seam`、`--nb-splitter-seam-inset`、`--nb-popover-scroll-fade`）登记在 `HOST_HOOK_VARS`，另有一条测试防它变成死条目。把 `--overlay-scrim` 放回去时规则报错（红翻转做过）。
   - Drawer 进 `useModalLayer`，与 Dialog、AlertDialog 按打开顺序叠放；向内容树提供 `NB_MODAL_POPOVER_Z_INDEX`，抽屉里的下拉与提示不再落在抽屉后面。新测试“抽屉里的 Select 压过抽屉、之后打开的 AlertDialog 压过抽屉”，两条断言分别去掉 provide、固定层级时都会失败。
   - Popover、Tooltip 改用 `usePopoverLayer`，删掉两处复制的 inject。L07 第 2 点（`tooltip` 档无人使用）与第 4 点（传送目标）不在本 Task。
2. **L02、L14**（be272cfa8）
   - `styles.css` 删掉零使用方的规则：`html { scrollbar-gutter: stable }`、`scheme-fade`、`nb-crystal-glow`、`nb-pop-in`、`animate-accordion`/`animate-collapsible` 与 `nb-accordion-content`（折叠动画的关键帧改名为 `nb-collapsible-down/up`）、`nb-ui-control-h-lg`、`nb-popover-enter/leave-active`。`nb-ui-switch-*` 与 `nb-ui-scrollbar-center` 在设计文档与规范里登记为配方，保留；`nb-ui-switch` 注释里旧应用的界面名去掉。
   - 删掉 `useAnchoredPopup`、`useResizablePanel`、`resolveApiErrorMessage`（`utils/api-error`）、`utils/focus-trap` 与依赖 `class-variance-authority`（neuro-book 与 playground 的 optimizeDeps 名单同步删）。旧应用与 llmlint 各有自己的同名实现，没有从 nb-ui 导入。
   - Nuxt 模块按 `components/index.ts`、`composables/index.ts` 的导出逐个登记（48 个组件、4 个 composable），内部零件不再成为全局名；`nuxt`、`@nuxt/kit` 改为可选 peer 依赖。`nuxt prepare playground` 后核对过生成的声明。
   - dev-panel 为撤销 nb-ui 全局规则写的 `html { scrollbar-gutter: auto }` 删掉。playground 整页会滚，改为自己在 `html` 上声明 `scrollbar-gutter: stable`：不声明时 390px 验收页的滚动条出现又消失，宽度来回变，nested-grid 的键盘调整提交不了（e2e 两条失败，补上后通过）。

没做的：L14 第 4、5 点（`./layout` 只导出在用的几何函数、根入口），属于公开入口的形状，归 w00030。

## 验证

- nb-ui：`bun run typecheck` 通过；单测 33 个文件 498 条通过；e2e 54 条通过（补 playground 槽位之前 nested-grid 的两条 390px 键盘调整失败，见上）。
- `bun run test:affected --since master --typecheck`：bun.lock 改动让全部包都在范围内。失败 4 项都与本改动无关：llmlint 的 typecheck 与 vitest（`web` 没装依赖、没有生成的 tsconfig）；`scripts/ci/workspace-workflows.test.ts` 的 code-baseline 路径缺 `packages/nb-form/**`、`neuro-book-test-support` 的 `paths.test.ts` 超长临时根一条，这两条在 master 上同样失败。
- neuro-book 整套 e2e：236 条通过，1 条失败（editor-area 场景 2 连引号加粗，t04 那轮也失败过），单独重跑通过。
- Lab 截图（nbook 明暗）：AlertDialog、Drawer 打开后背后的页面压暗加模糊；抽屉在 9000 层、整块在视口内。

## 下一步

无。L07 第 2、4 点与 L14 第 4、5 点归 w00030。
