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
5. **nb-harness 默认不带工具**：核实时发现 `createHarness` 总会挂上以 cwd 为根的读文件、改文件两个内置工具。开发者定：不加开关，nb-harness 默认就不该包含工具，工具全由调用方经插件给。改 `packages/nb-harness`（w00002 的包；目前只有它自己的测试调用 `createHarness`），读、改文件工具仍导出，要用的调用方自己装。
6. **Spec 假设**：会话里列的八条（防剧透、两种做法、挑章工具、答案格式、模型与密钥、过程与记录、回归门槛、Skill 不变）开发者确认“没有要改的”。
7. **前端组件**：对话、输入这类 Agent 组件用 w00019 在 Lab 里打磨过的那一套（现在在 `packages/neuro-book-legacy/app/components/agent/`），nb-story 与 NeuroBook 共用。
8. **先优化 nb-harness**：动 nb-story 之前，先看问答 Agent 要哪些能力、工具，要不要 TSX Profile，nb-harness 在这个场景好不好用。
9. **工具由 Profile 选（修订第 5 条）**：开发者看过分析后改定：nb-harness 可以有内置工具，用哪些由 Profile 决定；nb-harness 强制使用 Profile，nb-story 的问答也写 Profile。
10. **不加步数上限**：现在的模型很少失控，保持现状；以后有需要再在 nb-harness 里做失控保护。
11. **nb-harness 加单次请求**（不带工具的一次调用）。
12. **前端组件以后再议**：t05 先做 `nbstory ask`，网页问答页与对话组件的去处后续再讨论。

## 下一步

1. 读 nb-harness 与 t34 的问答脚本（`chapters-answer.ts`、作答规则 v5），核实 nb-harness 能否单独使用。
2. 写问答 Spec 与 `plan.md`，要点先给开发者看。
