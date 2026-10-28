---
schema: nbook.work/v1
workId: w00024-nb-story
issueId: null
status: active
updated: 2026-10-24
---

# nb-story 剧情图谱

## 目标

用已抽好的 V9 小说记忆图做剧情图谱第一版：网页查看器、问答界面、命令行与 Agent Skill；能单独使用，以后接成 NeuroBook 插件。设计依据是 w00005 的 nb-story 提案（accepted，2026-10-13）。

## 待确认

autonomous-delivery 推进时照推荐做了、本该由开发者决定的点，见 [待确认清单](pending-confirmations.md)。

## 后续安排

开发者 2026-10-21 定：

- 先做 t12（整理改成增量），之后把问答（`nbstory ask`）接进网页查看器，Task 到时再建。
- 2026-10-21 t12 完成后定：问答接进网页分两个 Task 顺序做。先 t08（`answer` 改成可选、连续对话、命令行追问），再 t13（网页问答页与设置页、共享包 `nb-agent-view`、问答页要用的 nb-ui 零件）。
- 2026-10-21 t08 完成（`05d36913f`）。t13 设计中途开发者改定：对话视图单独成包 `nb-agent-ui`、按归档 Spec 做完整版，作为主应用接入 Agent 对话的预演，工作移到重新打开的 [w00019](../w00019-agent-conversation-view/README.md)（t10 迁移、t11 补齐）；t13 等它们完成后再做，只留问答页、设置页、服务端接口与换手写控件。
- 2026-10-23 t13 完成并合入（`0972266fa`）：书里的问答页、设置页与服务端问答运行时；真实模型冒烟开发者定不做。
- 2026-10-24 开发者试用 t15 后提出输入框单行与控件、模型目录与自定义服务商、Markdown 作答，建 [t16](tasks/t16-qa-composer-models-markdown/README.md)，按 autonomous-delivery 推进。
- 2026-10-24 t16 合入（`b265707b2`），真实模型冒烟开发者定不做、待确认 7 条全部追认。开发者定把 nb-story 连同 8 个依赖包发布到 npm（只用 Bun、许可证 AGPL-3.0-only、加 `nbstory skill install`、更新文档与 README），建 [t17](tasks/t17-npm-release/README.md)，按 autonomous-delivery 推进；`publish` 由开发者执行。
- 2026-10-24 t17 合入（`fec3782ca`）；开发者发布了 9 个包（nb-ui `0.2.0`，其余 `0.1.0`），从 registry 安装的冒烟通过。
- 2026-10-24 t18 合入（nb-story 支持 Windows，去掉 `os` 字段，ADR 0031）；t19 用真实模型抽完《西游记》100 回并作为示例入库（约 ¥21.9）。2026-10-25 开发者确认 t19 暴露的七个管线问题全部修，建 [t20](tasks/t20-ingest-pipeline-fixes/README.md)，按 autonomous-delivery 推进（不跳章、密钥只读进程环境变量）。
- 2026-10-27 开发者实际使用后提了一批问题（关系图操作、设置与命令行、问答、图结构分级、GitHub 上已有的 issue 与 PR），记在 [t21](tasks/t21-usage-feedback/README.md)，未排期。
- 2026-10-27 [t22](tasks/t22-github-issues-256-259/README.md)：修 GitHub 上的 #256 到 #259（输出上限默认、推理档降档、`--version` 与动作帮助、目录外服务商的报错）；#253、#255 两个 PR 已审过合入本地 master。
- 值得收进 nb-ui、这次不做的候选（2026-10-21 调研，开发者定记入后续，按 w00029、w00030 的顺序另做）：外观主题的安装函数（nb-story 与 dev-panel 的 `host/theme.ts` 重复）、单个切换按钮 `Toggle`（nb-story 的 `story-chip` 与新应用工作台里手写的 `aria-pressed`）、dev-panel 的 `TruncatedText` 与 `LoadState`（剥掉路由与文案后叫 `AsyncState`）、`Toolbar` 放不下时收进“更多”（新应用 `plugins/workbench/web/items/item-strip.ts` 的 `layoutStrip`）、`CodeBlock` 与 dev-panel `DiffView` 合并、无限滚动的哨兵（nb-story `parts/PagedList.vue`）、dev-panel 的 `HighlightText`（先与 nb-ui 的 `option-highlight.ts` 对照）。2026-10-22 w00019 t10 计划补两项：原图预览对话框（t10 先放在 nb-agent-ui，等 w00030 拆完 Dialog 再进 nb-ui）、`CodeBlock` 的语法高亮。
- 搁置：t10 的两项可选真实模型评测（审查修正之后的回归重跑、挑选开着的长书对照），以及 decision 模型（Jev 等）召回的评测。

## 已知问题（记录，暂不处理）

- 已修（2026-10-20，8ebe77067，t09 跑全量时撞上）：`server.test.ts` 的“--json 时启动成功只输出一份 JSON……”偶发失败，`serve` 收到 SIGTERM 以 143 退出、留下 `.serve.json`。原因是 Bun 在 `Bun.serve` 监听期间，先打印、后在 Promise 里装信号处理时，紧跟着到的 SIGTERM 按默认动作杀进程（最小脚本要带着 `Bun.serve` 才复现，30 次全中）。改成先装处理再打印，30 次全好。
- 2026-10-27 [t29](tasks/t29-web-import-skill/README.md)：网页导入 V9 记忆图文件、删除书、安装 Skill（只允许 claude/codex 固定路径）；已合入本地 master。
- 2026-10-27 [t30](tasks/t30-qa-unextracted-books/README.md)：问答读未抽取章的原文（位置可选到尾部章，图只到抽取进度）。
- 2026-10-27 [t28](tasks/t28-graph-tiering/README.md)：图分级的小实验，脚本与计划已备好、干跑通过，卡在模型密钥（环境里没有）。
- 2026-10-28 [t32](tasks/t32-record-tiers/README.md) 完成并合入：记录分级（模型先验加程序后验），查看器默认折叠 3 级，命令行 `--tiers`、`--max-tier`、`why`；待确认的几条默认追认。
- 2026-10-28 [t33](tasks/t33-graph-issue-reports/README.md)：抽取时顺带报告图问题、另一个 agent 修复的实验（gpt-6-luna，约 ¥2.55）。逐章顺带报告只报得出马甲没连这一类、准确率低；事后扫描召回好但噪声大；修订都不能自动套用。建议与待开发者定的后续见 t33 README。
- 2026-10-28 开发者同意按 t33 的建议继续用 autonomous-delivery 推进：先做 [t34](tasks/t34-persona-link-probe/README.md)（程序找没连上的马甲、模型答窄问题的实验），再按结论做覆盖层与待确认修订、抽取上下文带说法类别、网关单条消息上限。
