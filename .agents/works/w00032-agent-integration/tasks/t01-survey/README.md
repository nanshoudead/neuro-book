---
schema: nbook.task/v2
taskId: t01-survey
status: active
updated: 2026-10-28
---

# 调研与讨论清单

## 目标与范围

接入 Agent 之前，查清仓库已有什么、开发者列的 20 条需求与现有文档和旧代码的对照、清单之外值得讨论的点，并按先后关系把讨论排成 Task（t02 到 t19）。只读调研，不改产品代码与 Spec。

合同：只读调研，行为合同未变。

## 当前状态

- 调研（2026-10-28）：
  - [仓库内的现状](../../research/2026-10-28-repo-survey.md)：harness 两条线、新应用现状、文档冲突、其它 Work 里相关的未完成事项、旧应用的 Agent 功能面、nb-story 问答的预演；
  - [外部参照](../../../../../docs/research/agent-runtime-references.md)：omp 与 DeepSeek Harness 的机制、模型接口与 OMP 包族的工具发现。
- 报告（`report` 产物）：[需求对照与遗漏](artifacts/report/index.html)，20 条需求与清单外 10 项，每条有一个选答的批注框，末尾是讨论顺序。
- 开发者 2026-10-28 的决定：
  1. 底座：以 master 的 nb-harness 为底座，参考内核分支 `feat/w00002-harness-kernel`，分支做得多的地方逐块移过来。
  2. 工具发现：在“插件给所有 Profile 加工具”时一起考虑（t04）。
  3. 新建本 Work，按先后关系建 Task 草稿，按顺序逐个讨论设计。
- 开发者的问题“分支为什么去掉 nb-session、nb-profile”已答：见调研“harness 的两条线”一节。要点：三个包并成一个包、按子路径导出，是开发者 2026-10-10 同意的；当时两个包没有使用方，新格式也与旧包不兼容。包分不分开在 t02 重新定。

## 下一步

开发者读报告、按需批注；从 t02 开始逐个讨论。批注用 `nbdev answers w00032-agent-integration t01-survey report` 读，读到的决定写进对应 Task 的 README。
