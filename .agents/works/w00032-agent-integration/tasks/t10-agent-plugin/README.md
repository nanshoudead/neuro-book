---
schema: nbook.task/v2
taskId: t10-agent-plugin
status: planned
updated: 2026-10-28
---

# Agent 插件骨架与贡献点

## 目标与范围

定内置插件 nbook.agent 的结构、贡献点清单与激活事件、服务端运行与界面推送，以及插件禁用、升级对运行中会话的影响。

来源：需求 3；清单外第 5 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- `nbook.agent` 的入口（服务端、浏览器）与依赖；harness 在服务端跑。
- 贡献点清单与激活事件：工具与工具组、Skill、Profile、文档、资源方案、斜杠命令、`@` 引用、工具渲染器、上下文槽、钩子、压缩方法；哪些写在清单里、哪些激活后登记。
- 运行不绑页面：服务端跑、推送、断线补齐（照 nb-story 的做法）。
- 插件禁用、升级、卸载时运行中会话的处理（平台提案 P1、P11）。
- 导出“以某 Profile 发起任务”。

## 材料

- [平台提案](../../../../../docs/proposals/extensible-application-platform.md) P1、P3、P9、P11
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)
- [`story/qa.md`](../../../../../docs/specs/story/qa.md) 的运行与推送

## 前置

t02 到 t09。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
