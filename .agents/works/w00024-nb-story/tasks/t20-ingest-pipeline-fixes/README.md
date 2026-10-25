---
schema: nbook.task/v2
taskId: t20-ingest-pipeline-fixes
status: active
updated: 2026-10-25
---

# 抽取管线七点修复

## 目标与范围

按 t19 西游记抽取暴露的七个问题修管线：限流退避、用量补记、坏回复留存、自动续跑、密钥来源、价格提示、人物合并

合同：改 [`story.ingest`](../../../../docs/specs/story/ingest.md) 与 [`story.cli`](../../../../docs/specs/story/cli-skill.md)，并加 ADR 0032。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-25 开发者确认七点全部按推荐修，按 autonomous-delivery 推进；不跳章、密钥只读进程环境变量已定。计划写好，待设计审查。

## 下一步

设计审查；处理后按切片 1 到 5 实施。
