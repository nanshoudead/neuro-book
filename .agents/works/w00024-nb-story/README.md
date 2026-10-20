---
schema: nbook.work/v1
workId: w00024-nb-story
issueId: null
status: active
updated: 2026-10-13
---

# nb-story 剧情图谱

## 目标

用已抽好的 V9 小说记忆图做剧情图谱第一版：网页查看器、问答界面、命令行与 Agent Skill；能单独使用，以后接成 NeuroBook 插件。设计依据是 w00005 的 nb-story 提案（accepted，2026-10-13）。

## 已知问题（记录，暂不处理）

- 已修（2026-10-20，8ebe77067，t09 跑全量时撞上）：`server.test.ts` 的“--json 时启动成功只输出一份 JSON……”偶发失败，`serve` 收到 SIGTERM 以 143 退出、留下 `.serve.json`。原因是 Bun 在 `Bun.serve` 监听期间，先打印、后在 Promise 里装信号处理时，紧跟着到的 SIGTERM 按默认动作杀进程（最小脚本要带着 `Bun.serve` 才复现，30 次全中）。改成先装处理再打印，30 次全好。
