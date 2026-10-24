---
schema: nbook.task/v2
taskId: t17-npm-release
status: active
updated: 2026-10-24
---

# nb-story 与它依赖的 8 个包发布到 npm

## 目标与范围

nb-story 连同 8 个内部依赖包（nb-ui、nb-agent-ui、nb-form、nb-markdown、nb-harness、nb-profile、nb-session、nb-runtime）作为 npm 包发布，只用 Bun 运行；加 `nbstory skill install`；更新文档与 README。最后一步 `publish` 由开发者执行。

合同：会改 [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（不再“只从仓库运行”、新增 `skill install`）；新增一份 ADR（工作区包的发布形态，`packages/AGENTS.md` 要求公开包名、版本、exports 与发布合同先记为跨 Module 决策）；[nb-story 提案](../../../../../docs/proposals/novel-story-app.md) 追加决策记录。

计划：[plan.md](plan.md)。

## 决定

开发者 2026-10-24 在会话里定：

1. 发布前不做真实模型冒烟。
2. t16 待确认的 7 条全部追认。
3. 整个 monorepo 照旧是 AGPL-3.0-only，发布的包也是。
4. 只支持 Bun 运行。
5. 9 个包都发布（不打成一个包）。
6. 加 `nbstory skill install`。
7. 文档与 README 要更新。

## 当前状态

2026-10-24 计划写好，待设计审查。

## 下一步

1. omp 设计审查（后端、计划）；处理后按切片实施。
