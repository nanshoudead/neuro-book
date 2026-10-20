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

- `packages/nb-story/src/server/server.test.ts` 的“--json 时启动成功只输出一份 JSON；书库目录用不了时退出码 3”偶发失败：`serve` 收到 SIGTERM 后以 143 退出（没走自己的停止流程），留下 `.serve.json`。2026-10-20 在 master 上连跑 12 次挂 5 次。信号处理在打印登录链接的同一段同步代码里装好，用最小脚本复现不出，原因未明。开发者 2026-10-20 定：先记录，不处理。
