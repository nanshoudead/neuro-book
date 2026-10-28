---
schema: nbook.task/v2
taskId: t05-profile
status: planned
updated: 2026-10-28
---

# Profile：定义、存放层次、钩子与设置

## 目标与范围

定 Profile 的定义形状、存放层次（内置、用户、项目）、钩子、设置表单与上下文槽，以及用户能否自己写 Profile。

来源：需求 6、7（钩子部分）（[报告](../t01-survey/artifacts/report/index.html)第 6、7 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- `defineProfile` 的形状：master 的四个字段，分支的一等属性（tools、model、compaction、approval）、可注册的节点与数据源与字段、`<Slot>`。
- 存放层次与覆盖：内置、用户级、项目级；加载、文件改动后重载；用户自己写或从模板新建（加载即执行代码）。
- 钩子：每次模型请求前、工具调用前后、一轮结束；Profile 自己的钩子与插件的全局钩子；顺序、合并与失败处理。
- 旧应用的字段要不要：设置表单（人设、文风预设）、每轮结构化输入、结构化结果、`skills.include`。
- Profile 改版后旧会话能不能续（nb-story 从 v3 到 v4 的经验）。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节 Profile
- `packages/nb-profile`；分支上的 `docs/specs/harness/profile.md`
- 旧应用 `packages/neuro-book-legacy/assets/reference/agent/profile-guide.md`

## 前置

t02、t04。

## 当前状态

草稿，未开工（2026-10-28 建）。

## 下一步

轮到时与开发者逐条讨论，决定写进本 README，再按 implementation-planning 写计划。
