---
schema: nbook.task/v2
taskId: t03-session-model
status: planned
updated: 2026-10-28
---

# 会话模型：条目树、回退与分支、存放与单写者

## 目标与范围

定会话日志的数据模型（条目树与当前叶子），支撑回退、分支、fork、重试与 swipe；定会话存放位置与多窗口、多实例下的单写者。

来源：需求 17；清单外第 4 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 条目树：`id`、`parentId`、当前叶子；master 的 nb-session 只有序号，分支的格式已按树（v1 只用一条链）。
- 用户操作：回退、从此处分支、编辑重发、重试、swipe（同一父节点下的兄弟分支）、fork（新会话：复制还是引用历史）、`/clear`；nb-agent-ui 的分支与树面板从哪取数据。
- 会话快照与恢复按当前叶子走；与“前缀稳定、只追加”的关系。
- 存放位置：状态根下的插件数据，还是项目目录（旧应用是 `.nbook/agent/sessions/`）；会话属于项目还是跨项目。
- 单写者：多窗口、多实例打开同一会话（ADR 0024）；旧应用的会话租约 Spec（planned）。
- nb-story 已有的会话日志怎样兼容。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 1、5 节
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 2 节（omp 的会话树与斜杠命令）
- 分支上的 `docs/specs/harness/session.md`
- [`archived/specs/agent/session-store-lease.md`](../../../../../docs/archived/specs/agent/session-store-lease.md)

## 前置

t02。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
