---
schema: nbook.work/v1
workId: w00024-nb-story
issueId: null
status: active
updated: 2026-10-21
---

# nb-story 剧情图谱

## 目标

用已抽好的 V9 小说记忆图做剧情图谱第一版：网页查看器、问答界面、命令行与 Agent Skill；能单独使用，以后接成 NeuroBook 插件。设计依据是 w00005 的 nb-story 提案（accepted，2026-10-13）。

## 后续安排

开发者 2026-10-21 定：

- 先做 t12（整理改成增量），之后把问答（`nbstory ask`）接进网页查看器，Task 到时再建。
- 2026-10-21 t12 完成后定：问答接进网页分两个 Task 顺序做。先 t08（`answer` 改成可选、连续对话、命令行追问），再 t13（网页问答页与设置页、共享包 `nb-agent-view`、问答页要用的 nb-ui 零件）。
- 2026-10-21 t08 完成（`05d36913f`）。t13 设计中途开发者改定：对话视图单独成包 `nb-agent-ui`、按归档 Spec 做完整版，作为主应用接入 Agent 对话的预演，工作移到重新打开的 [w00019](../w00019-agent-conversation-view/README.md)（t10 迁移、t11 补齐）；t13 等它们完成后再做，只留问答页、设置页、服务端接口与换手写控件。
- 值得收进 nb-ui、这次不做的候选（2026-10-21 调研，开发者定记入后续，按 w00029、w00030 的顺序另做）：外观主题的安装函数（nb-story 与 dev-panel 的 `host/theme.ts` 重复）、单个切换按钮 `Toggle`（nb-story 的 `story-chip` 与新应用工作台里手写的 `aria-pressed`）、dev-panel 的 `TruncatedText` 与 `LoadState`（剥掉路由与文案后叫 `AsyncState`）、`Toolbar` 放不下时收进“更多”（新应用 `plugins/workbench/web/items/item-strip.ts` 的 `layoutStrip`）、`CodeBlock` 与 dev-panel `DiffView` 合并、无限滚动的哨兵（nb-story `parts/PagedList.vue`）、dev-panel 的 `HighlightText`（先与 nb-ui 的 `option-highlight.ts` 对照）。2026-10-22 w00019 t10 计划补两项：原图预览对话框（t10 先放在 nb-agent-ui，等 w00030 拆完 Dialog 再进 nb-ui）、`CodeBlock` 的语法高亮。
- 搁置：t10 的两项可选真实模型评测（审查修正之后的回归重跑、挑选开着的长书对照），以及 decision 模型（Jev 等）召回的评测。

## 已知问题（记录，暂不处理）

- 已修（2026-10-20，8ebe77067，t09 跑全量时撞上）：`server.test.ts` 的“--json 时启动成功只输出一份 JSON……”偶发失败，`serve` 收到 SIGTERM 以 143 退出、留下 `.serve.json`。原因是 Bun 在 `Bun.serve` 监听期间，先打印、后在 Promise 里装信号处理时，紧跟着到的 SIGTERM 按默认动作杀进程（最小脚本要带着 `Bun.serve` 才复现，30 次全中）。改成先装处理再打印，30 次全好。
