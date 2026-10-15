---
schema: nbook.task/v2
taskId: t05-qa
status: active
updated: 2026-10-15
---

# nb-story 内置问答：网页问答页与 nbstory ask

## 目标与范围

在 nb-harness 上做 nb-story 的问答引擎：默认“图当目录”（挑章 Agent 用查询接口找出至多 20 章，再只凭这些章的原文作答），可选“全读”。网页问答页与 `nbstory ask` 共用这一个引擎。用 t34 的题回归，不劣于提案定的基线。

合同：待写 `docs/specs/story/` 下问答的 Spec（`planned`），并改 queries、viewer、cli-skill 里“不做内置问答”的条目。依据：[剧情图谱提案](../../../../../docs/proposals/novel-story-app.md)第四节第 6 小节“问答”与 2026-10-15 的决策记录。

## 当前状态

- 2026-10-15：经 nbdev 新建（建时 slug 误写成 `t05-qa`，生成了 `t05-t05-qa`，已改名）。开发者定了方向（见“决定”）。

## 决定

开发者 2026-10-15 在会话里定（t03、t04 合入之后）：

1. **提前做内置问答**：改掉 t02 决定 5（等 Agent 框架与 nb-harness 定了再做）。
2. **引擎建在 nb-harness 上**：挑章 Agent 用 nb-story 的查询接口当工具，经 nb-harness 的循环运行；以后接成插件不用换。计划阶段先核实 nb-harness 能否在包外单独使用，不行再回来问。
3. **入口**：网页问答页加 `nbstory ask`，同一个引擎；两种做法都可选，默认图当目录，原文超过上限时全读不可选（提案原样）。
4. **顺序**：先做问答（本 Task），再做 ingest（[t06](../t06-ingest/README.md)）。

## 下一步

1. 读 nb-harness 与 t34 的问答脚本（`chapters-answer.ts`、作答规则 v5），核实 nb-harness 能否单独使用。
2. 写问答 Spec 与 `plan.md`，要点先给开发者看。
