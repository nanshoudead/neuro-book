---
schema: nbook.task/v2
taskId: t03-impl
status: planned
updated: 2026-10-15
---

# nb-story 第一版实现

## 目标与范围

按 story.queries、story.viewer、story.cli 三份 Spec 实现 packages/nb-story：核心库、命令行、独立服务、网页查看器与 Skill

合同：[`story/queries.md`](../../../../../docs/specs/story/queries.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（`planned`）。计划：[plan.md](plan.md)。

## 当前状态

- 2026-10-15：经 nbdev 新建；计划初稿写好，开发者确认（见“决定”）。
- 2026-10-15：omp 审查计划，18 条，处理写进 [plan.md](plan.md) 的“计划审查”一节，报告 [evidences/plan-review.txt](evidences/plan-review.txt)。worktree `.worktree/w00024-t03-impl`（分支 `feat/w00024-nb-story`）。

- 2026-10-15：S1 到 S5（书库、查询、命令行、服务）与 Skill 完成；omp 代码审查 16 条（阻断 1：情节步骤的出处晚于情节自己的位置，提前泄露后文），全部处理（`c31dc676b`、`b31f9531b`），报告 [evidences/code-review-s1-s5.txt](evidences/code-review-s1-s5.txt)。处理中改了成立位置的取法：每条记录取自身位置与全部出处终点里最晚的那个。
- 2026-10-15：S6 到 S9 网页查看器与 e2e 完成（`d2f83b306`、`5954422bf`）：包内 142 条测试、e2e 12 条（验收 1 到 8、时序、登录、命令行地址）通过。e2e 发现并修了两处界面缺陷（地址覆盖存下的状态时打开即保存；地址总写视角）。Sonnet 前端审查 31 条（阻断 1、重要 10、建议 20），报告 [evidences/frontend-review.txt](evidences/frontend-review.txt)，处理后 `39d1c32e7`：e2e 13 条、包内 142 条通过。只改了一部分或不改的：第 13 条悬停时“其余点名字保留”只有截图证据（画布读不到字）；第 15 条浮层补了对话框语义、Escape 与点外关闭，没做焦点圈定；第 17 条原生复选框换成 FormCheckbox，类别与层的开关仍用自写的 chip（带 aria-pressed），没换 ToggleGroup；第 19 条全书图补了选中与“只看选中的周边”，名字在相邻格子里的重叠没处理（输出 25 的不重叠只约束关系图）；第 23 条跨宽度档时抽屉内的筛选会重置，人与页签保持（Spec 说的“内容不变”成立）；第 26 条抽屉里的原文、段落记录、连线说明不进地址（临时视图，Spec 的地址形状里没有），原文页的章写进了地址，F3 由此可达；第 29 条任务状态仍按文字判断（数据里没有枚举）。
- 和计划不同的两处：三栏用 nb-ui 的 Splitter（t01 定稿的草稿用它），没用 createGrid；S1 到 S5 没有单独先合入，因为审查修正与网页提交交错，改为前端审查处理完后整条分支一起合入。

## 决定

开发者 2026-10-15 在会话里确认计划，并定：

1. **样例书进 Git**：t34 的 100 章数据 gzip 后放 `packages/nb-story/tests/fixtures/`，测试与验收都用它。
2. **网页组件不在 Component Lab 登记**：照 dev-panel，界面靠真实服务加 Chromium 的 e2e 与截图验证；接成插件时再登记。
3. **S1 到 S5 做完先合入一次**，不等网页。

## 下一步

1. 整条分支合入 master。
2. S10：用外部 Agent 跑 Skill 评测（`story.cli` 验收 5，16 题各 3 遍），答案与判分进证据。
3. 晋升三份 Spec 为 implemented（开发者批准）。
