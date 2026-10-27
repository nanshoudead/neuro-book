---
schema: nbook.task/v2
taskId: t30-qa-unextracted-books
status: in-progress
updated: 2026-10-27
---

# 问答：没抽完的书可以读后面章节的原文

## 目标与范围

[t21](../t21-usage-feedback/README.md) 反馈 5 的最后一条，开发者在评审板第 4 题定了做法：阅读位置可以选到最新章，抽取进度之后助手只有读原文这一个工具。开发者 2026-10-27 批准做。

范围：问答的阅读位置（新对话、中途改位置、`ask --at`）可以选到原文已切好但还没抽到的章；这些章里助手能用 `read` 读原文，图工具只回答到抽取进度为止。不改抽取管线，不在查看器里显示未抽取章的原文。

## 当前状态

2026-10-27 实现完成，分支 `feat/w00024-t30-unextracted`，待全量验证后合入。计划见 [plan.md](plan.md)，设计审查（8 条，全部成立）见 [design-review.txt](evidences/design-review.txt)。行为合同：[`story.qa`](../../../../docs/specs/story/qa.md) 输出 42，[`story.viewer`](../../../../docs/specs/story/viewer.md) 输出 55，`book.info.unextracted` 见 `story.queries`。

- 核心：`core/unextracted.ts`（读抽取记录 `source.json`，结构校验加按已提交各章段数的指纹，缓存按路径加修改时间与大小）、`book.info.unextracted`、`BookSession.unextracted()`。
- 问答：`qa/reach.ts`（可到达范围、`readRange`）；引擎用它落位置、建账本、全读；`tools.ts` 的 `read` 经 `readRange`，其余图工具用图位置并在结果末尾带提示，`chapter`、`para` 指向尾部章时说只能读原文；位置提醒在目标是尾部时多一句；系统提示词只加一句固定的话，不写具体章号。
- 网页：位置控件可选到尾部章，旁边写图的进度；`@` 的章节与段落候选用完整段数表，对象候选取抽取进度；答案、Markdown、没核实的出处里指向尾部章的出处保持纯文字（`web/qa/linkable.ts` 经 provide/inject）。
- 验证：新增 `qa/reach.test.ts`（6 条）、web 单测与一个 e2e（部分抽取的书）；其余见下面“实现审查待处理”。
- 实现审查待做。
