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
- 实现审查：t29、t30、关系图应力排版与上一轮修复批一起交 omp，报告 [impl-review-t29-t30-layout.txt](evidences/impl-review-t29-t30-layout.txt)，9 条（重要 5、建议 4），全部成立，分支 `fix/w00024-t29-30-review` 已合入：
  1. 尾部指纹改为核对已提交各章的原文哈希（不再只比段数）；
  2. 解析缓存键含 inode、变更时间、修改时间与大小，用同一个文件句柄取版本和读内容；
  3. 出处能否打开看范围终点章，`openTarget` 再兜底拦截显式链接；
  4. “只画最强的线”先按画布同一条规则（`web/graph/edge-parts.ts`）算出画出来的线再排名，身份线不参与；
  5. 自定义模型目录保留配置里的币种；
  6. base64 长度扣填充；
  7. `chapter`、`para` 只对 `source.json` 里实际存在的尾部章说“只能用 read”；
  8. 位置提醒里的“图只抽到第 N 章”在图后来推进后，工具结果补一句现在的进度；
  9. 不给书名导入非 V9 文件报 `unsupported_format`。
  e2e 42 过、1 个 1 秒阈值的“长列表”性能用例在机器负载下失败（既有，与改动无关）。
