---
schema: nbook.task/v2
taskId: t02-tailwind-unify
status: done
updated: 2026-10-21
---

# 全仓统一用 Tailwind v4，宿主编译 nb-ui

## 目标与范围

neuro-book 从 UnoCSS 换到 Tailwind v4；nb-ui 不再发预编译产物，提供样式入口由宿主编译；nb-story、dev-panel 改用同一入口；滚动条 token

合同：产品行为合同未变；改的是样式的构建与接入方式，ADR 0023 的前端一条随之修订（见计划 S5）。

## 当前状态

2026-10-20 新建并写了实施计划 [plan.md](plan.md)（含在 master 上实测的改动面）。2026-10-21 开发者确认计划；w00027 t07 的 S2a、S2b 已进 master，开工。

- worktree：`.worktree/w00030-t02-tailwind`，分支 `refactor/w00030-t02-tailwind`

- S0（2026-10-21）：工具 1 到 4 写好，放在分支的 `scripts/nb-ui/tailwind-migration/`；重测的改动面与分层冲突写进计划的“改动面”“分层后结果会翻转的地方”两节（10-20 的初测处数有误，已改）。切片重排为 S1 到 S4，每个提交都能通过验证：nb-ui 产物在 S1 冻结、S2 neuro-book 换掉 UnoCSS 时删除。
- 改前基准截图：开发服务开在固定于 master 的 worktree `.worktree/w00030-t02-baseline`（端口 4317），状态根用 `/tmp/t02/state-template` 的副本（登记了示例作品 `book`）；截图在 `/tmp/t02/before/`（Lab 107 个组件 501 个场景 × 两主题 × 明暗，加 4 个页面 × 明暗）。

- S1（分支 2530d26de）：nb-ui 样式入口与分层，playground、nb-story、dev-panel 改用。nb-ui、nb-story、dev-panel 的 typecheck、单测与构建通过；nb-ui e2e 55 条中 `popup-scroll` 一条在截基准图占 CPU 时超时，单独重跑通过。
  - 子代理修了冲突扫描工具的一处缺陷（共用 `Scanner` 会丢掉见过的候选），修后 A 类远多于 S0 所记的 21 条；主要是焦点环被控件自己的 `shadow-*`、`transition-*` 压过。处理：`.nb-ui-focus-ring` 的 `box-shadow`、`transition` 带 `!important`（层内 important 压过原子类，结果同分层前，也是层机制给必须生效的样式留的写法）；Switch、RadioGroup 补 `focus-visible:` 边框；删分层前就被语义类压掉的死原子类。
  - `@source` 经 workspace 软链能扫到 nb-ui 组件（nb-story、dev-panel 产物里查到只在 nb-ui 用的类），计划里的这条风险不成立。
  - dev-panel 的 `:where(a, button, …):focus-visible` 焦点环进 base 层后，只靠 `outline-none` 的 nb-ui 按钮键盘聚焦时不再多画面板的 2px 轮廓，截图对照时留意。
  - llmlint 的检测页也用 UnoCSS，但它是另一个应用、不用 nb-ui，不在本 Task 范围。

- S2（分支 1c360ee8f）：neuro-book 换成 Tailwind v4（reset 与 `styles.css` 的全局规则进 base 层），`outline-none` 改名 7 处，删 `uno.config.ts`、`unocss` 依赖、nb-ui 的 `dist/nb-ui.css` 与 `./styles.css` 导出。neuro-book typecheck、单测、`build`、`build:e2e` 通过；`test:affected` 只有已知的两项无关失败（llmlint web 依赖、长根路径）。工具 1 的差异只剩计划所列几类（另有几条是对比工具把 `var()` 解析成值造成的假差异）。
- S4（滚动条 token）已派出：取值统一到 `OverlayScrollbar` 现在的 32%/45%/55%，`ScrollArea`、`PopupScrollbar` 与三个宿主的原生滚动条颜色随之变化；共用类用 `:where()` 连后代一起写（`scrollbar-width` 不继承）。

- S4（分支 464a59905）：滚动条 token 与 `.nb-ui-scrollbar-thin`，滑块几何合成 `utils/scrollbar-geometry.ts`（弹出列表最短滑块 24px → 20px）。nb-ui 单测、四个包的 typecheck、`popup-scroll` e2e 通过。另修 CI 矩阵里 nb-ui 还在跑已删的 `build:css`（5f0b5902b）。
- S3（分支 4999847d0）：文档。ADR 按仓库规则不改 0023 正文，新增 ADR 0028 部分取代它。`docs:check`、`governance:check` 无新增问题。
- 截图：改前 2012 张（`/tmp/t02/before/`）；改后在 S2 提交上截（`/tmp/t02/after-s2/`，只看引擎切换的差异）。页面 4 张明暗各一都有几百到一千像素差异，看过书架页：小字 14→13px、分段控件与下拉框恢复 nb-ui 自己的字号与阴影（L01 的修正），属预期。
- 实现审查（Sonnet，7 条，全部成立）与处理见 [evidences/impl-review.txt](evidences/impl-review.txt)，修正提交 c94b2e2f7。要点：生产构建换用排除 Lab 与 e2e 外壳目录的样式入口（Tailwind 按目录扫描，Lab 独有的类曾进可分发产物）；`check:dist` 查分层；滚动条 token 改存比例、在元素上现场混色（第一种修法被 `tokens.test.ts` 的既有守护拦下）；文档写出完整的宿主写法；补 Lab e2e。
- 截图对照（S2 提交对 master）：Lab 2004 张有差异 1348 张，页面 8 张都有差异。按组件看了差异最大的二十多个与几个差异小、可能不是字号的：全部来自宿主与 nb-ui 组件的字号 14px → 13px（nb-ui 组件恢复自己的取值，即 L01 的修正）及其带来的换行、行高与高度变化；另有动画（NeuroBookMood）与截图时机（EditorArea 改前截在内容加载之前）造成的噪声。没有发现预期之外的外观变化。审查第 3 条列的 `shadow-sm`、`backdrop-blur-sm`、`outline-none` 在 nb-ui 组件里改取 Tailwind v4 的值，与 nb-ui 在其它宿主里的样子一致，记为预期差异。
- e2e 暴露两处并修正（9e0d6dd4e）：Select 的箭头一直不转（`data-[state=open]:` 写在箭头自己身上，master 上就是这样），改按触发器的命名 group；Lab 事件日志的行按钮手写的焦点轮廓在 UnoCSS 下从不显示、现在显示，被 Lab 的光晕检查当成会被裁，改用内嵌焦点线 `nb-ui-focus-ring-inset`。
- 合入前把 master 并进分支（w00027 t02 的设置窗口、nb-story t08），用迁移工具重扫：neuro-book 新代码没有要改名的类，类名对比没有新增差异，分层扫描 B 类 0 条。之后 neuro-book 单测 1599、Vitest 403、`build` 含 `check:dist`、整套 e2e 256 条、nb-story e2e 20 条通过；`test:affected` 只有已知的三项无关失败（llmlint web 依赖在 worktree 里没装、长根路径）。
- nb-ui e2e：`popup-scroll` 的“拖动滑块到两端：页面 CSS zoom 下”在整套与重复运行里各失败过 1 次（拖动几乎没有带动滚动），单独 10 遍、整份 8 遍在 S4 前后的代码上都全过，未能复现、看不出与 S4 的滑块几何合并有关，记为偶发。
- 2026-10-21 合入 master（a69d44003）；临时迁移工具已删（f4e0748bc）；`docs/proposals/neuro-book-v2-rebuild.md` 追加决策记录。

## 下一步

无。后续是 w00030 t03（弹出列表零件）。
