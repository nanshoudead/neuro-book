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

## 讨论进展（2026-10-28，第一轮）

开发者已定：

- Profile 不指定模型角色。
- `skills.include` 不要：Skill 目录怎样进提示词在 t15 定。
- 设置表单（`settingsSchema` 交 nb-form 画、值存进 Profile 设置）有用，第一轮不做。
- 存放三层：Agent 插件内置、其它插件贡献（经插件共享，借插件依赖保证工具已装）、用户级；不做项目级，不做同名覆盖。key 带来源前缀（`builtin.writer`、`story.qa`、`user.my-writer`）；改内置的就复制到用户级换新 key，“从模板新建”即复制。
- 用户可以写 TSX Profile（与插件同样受信任）；用户级 Profile 的必需工具不在时，列表里标“不可用”并写明缺哪个。
- 保留文件改动后重载（内存增长在计划时处理）。
- Profile 改版按 t04 的方案 D 处理：版本变也算“Profile 变了”，提示词用新的，初始输入按新 schema 重新校验，不过就只读；nb-story“按版本一律拒绝”的规则随迁移去掉。
- `defineProfile` 以分支实现为主体：manifest、initialSchema、tools（只声明）、context，可注册的节点、数据源与字段。
- 结构化结果用 master 的收尾工具，不另设字段；每轮结构化输入不做；文件变化感知在 t13。

待议：compaction 与 approval 在 Profile 里的位置；钩子（开发者认为全局钩子有用，且应与 Profile 钩子同样可读写，要举例再想）。

## 当前状态

讨论中。

## 下一步

定 compaction、approval 与钩子后写进本 README。
