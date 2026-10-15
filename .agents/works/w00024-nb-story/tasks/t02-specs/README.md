---
schema: nbook.task/v2
taskId: t02-specs
status: active
updated: 2026-10-15
---

# nb-story 第一版的 planned Spec

## 目标与范围

把 t01 定下的设计（决定 1 到 26）与 nb-story 提案写成 docs/specs/story/ 下四份 planned Spec：queries、viewer、qa、cli-skill；先把提案从 w00005 分支搬到 master。要点先给开发者看，确认后再提交。

合同：新建 `docs/specs/story/queries.md`、`story/viewer.md`、`story/qa.md`、`story/cli-skill.md`（`planned`，正文待写）。依据：[nb-story 提案](../../../../../docs/proposals/novel-story-app.md)、[V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)、[t01 的决定](../t01-ui-design/README.md#决定)。

## 当前状态

- 2026-10-15：两份提案从 w00005 分支搬到 master（`docs/proposals/novel-story-app.md`、`novel-memory-v9.md`）：加了提案 frontmatter（accepted），正文开头的“状态”一句去掉，指向 w00005 分支上 Task 记录的链接改写成文字引用（master 上没有这些文件），登记进提案目录的活跃提案。w00005 合并回 master 时这两个文件会冲突，以 master 上的为准。
- 2026-10-15：要点评审板 [artifacts/review/index.html](artifacts/review/index.html) v1：能力地图（`story.queries`、`story.qa`、`story.viewer`、`story.cli`）与各份要点，问四题：能力地图（`capability-map`）、阅读状态存哪里（`reading-state-store`）、知情视角里“没有记录”怎么算（`no-record-perspective`）、位置之后的原文能不能看（`source-beyond`）。

## 设计审查（2026-10-15）

一个 omp 会话（默认模型）只读审查三份草稿，报告 [evidences/design-review.txt](evidences/design-review.txt)：15 条（阻断 1、重要 12、建议 2），核实后都成立，都已改进草稿：

1. 身份合并不能只看身份秘密：秘密的两端与它名下说法的两端不一致，候选、角色台词也混在里面。改为按“确定的身份连接”（确定性为确定的旁白明说或角色认为）合并，角色台词与候选不合并、给 `identity: "uncertain"`；验收改成数据实际给出的位置（6.96、27.90、37.8）。原验收“第 7 章两点、第 8 章一点”与数据不符，已删。
2. 全书抽取统计无法按阅读位置还原：`book.stats` 分成按位置的 `visible` 与不随位置变、标明覆盖全书的 `extraction`。
3. 秘密矩阵的读者行与角色的中间状态：读者行看秘密名下有没有一条已成立的确定连接；`identity` 补上听说、认为、怀疑三种状态；同一位置以对秘密的知情记录为准。
4. 主线是每 5 章一批的快照：只取最近一批，没收进去的情节标“未归入主线”；一段情节可以属于几条主线。
5. 本章位置之后的原文这条例外统一写在 `story.queries`，查看器与命令行引用它；段落概要只在整段范围可见时给。
6. 书的一代：同 id 重新导入是新的一代，查询固定在开始时的那一代，游标绑定一代与参数，失效报 `cursor_invalid`。
7. 服务登记：带实例号，按“地址能连上且实例号相同”判定有效；启动先监听再登记，停止先撤销自己的登记。
8. 登录：登录链接的形状、唯一的免会话地址、口令可重复使用、会话到服务停止为止；错误码与 HTTP 状态码的对应表。
9. 阅读状态：整份替换、返回成功即已写入；查看器在最后一次变化后 1 秒内与页面隐藏时保存，同时只有一次在途。
10. 方法表补上每个方法结果里必须有的字段；书库级方法不带 `book`；名字对应多个对象报 `entity_ambiguous`；命令拆成一条命令一个方法，查看器专用的四个方法不出命令。
11. 页面地址的形状写进 `story.viewer`；地址写明的部分优先于存下的状态。
12. 记录标记（明说、角色的说法、角色认为、推断）、记录编号与段落概要默认收起、琐碎悬念的判据写进去。
13. Skill 验收：原 16 题只有 4 题在第 38 章以内；改为每题按它自己的阅读位置问，同一 Agent 答 3 遍共 48 份，一审答错不超过 11 份（与基线相同），换 Agent 重跑。
14. 1 秒判据补上计时条件与终点。
15. 失败表补编号。

## 决定

要点评审板 v1（开发者 2026-10-15 在面板上答复，答复 `20261015T025503509Z-6f8f61ff`）：

1. **能力地图（`capability-map`）**：按 `story.queries`、`story.qa`、`story.viewer`、`story.cli` 四份分。备注：问 `story.qa` 打算怎么做（内置，还是命令行加 Skill，还是为以后接 NeuroBook 插件做准备）；提供工具时命令行与工具本质上是一套接口；独立服务的网页问答可以先不做，因为 Agent 框架还要讨论、nb-harness 还没做好。
2. **阅读状态（`reading-state-store`）**：“读到哪里”与上次的界面存进书库，跟着书走。
3. **知情视角里的“没有记录”（`no-record-perspective`）**：仍画成分开的点，但标“没有记录”，与“明确不知道”区分。
4. **位置之后的原文（`source-beyond`）**：不给；接口拒绝（`beyond_position`），本章内位置之后的段落给原文、不给记录。

要点评审板 v2（开发者 2026-10-15 在面板上答复，答复 `20261015T025951971Z-73d6a6cb`）：

5. **问答范围（`qa-scope`）**：内置问答整个不做：不做网页问答页、顶栏提问框，也不做 `nbstory ask`；做成 Skill 加命令行，由外部 Agent 作答。答复里选的是 `keep-cli-ask`，但备注写“nbstory.ask 也不用做。做成 skill + cli，外部 agent 来做 agent”，与所选项相反，按备注的文字记。连带：
   1. 能力剩三份：`story.queries`（含工具接口：每个查询方法的参数与结果有 schema，命令行与以后插件的 Agent 工具共用）、`story.viewer`、`story.cli`（命令行加 Skill）；`story.qa` 不写。
   2. 查看器去掉顶栏提问框与问答页（t01 决定 3、决定 9 的页面推迟）；决定 9 的答案格式写进 Skill。
   3. 命令行每条查询命令对应接口合同里的一个方法，`--json` 输出就是方法结果，参数同名。
   4. 提案的决策记录记下这次范围调整。

要点评审板 v3（开发者 2026-10-15 在会话里口头答复，Agent 代录为答复 `20261015T032255034Z-65c46c92`）：

6. **写正文时自定的十条（`spec-judgments`）**：可以，交审查。另定：几乎是纯文字、解释不复杂的问题以后直接在会话里问，不发评审板（已写进 design-review Skill）。

## 下一步

1. 三份正文初稿已写在主工作区（未提交）：`docs/specs/story/queries.md`、`viewer.md`、`cli-skill.md`，已登记进 `docs/specs/README.md` 的待实现规范（未提交），`docs:check` 通过。要点评审板 v3 问写正文时自定的十条（`spec-judgments`）。
2. 交 omp 审查（后端、领域与设计），处理意见后提交；之后写实施计划。
3. （原计划）按决定 1 到 5 写三份 Spec 正文，登记进 `docs/specs/README.md` 的待实现规范，跑 `bun run docs:check`；正文按记忆先给开发者看要点，再交 omp 审查、提交。
