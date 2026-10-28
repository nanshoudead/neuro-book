---
schema: nbook.task/v2
taskId: t38-overlay-revisions
status: active
updated: 2026-10-28
---

# 图的修订：覆盖层、待确认页、人物卡确认与修改

## 目标与范围

实现 story.revisions（planned）与查看器输出 58 到 62、命令行 nbstory revisions；依据 t37 的评审与决定

合同：[`story.revisions`](../../../../docs/specs/story/revisions.md)（planned）、[`story.viewer`](../../../../docs/specs/story/viewer.md) 输出 58 到 62、[`story.cli`](../../../../docs/specs/story/cli-skill.md) 的 `nbstory revisions`。来源：[t37](../t37-overlay-revisions-design/README.md)（界面设计与决定）。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-28 经 nbdev 新建（autonomous-delivery）。计划已写，交 omp 做设计审查。

## 设计审查（2026-10-28）

omp（默认模型）审计划与 Spec：[报告](evidences/design-review.txt)，12 条（阻断 3、重要 8、建议 1）全部成立，计划与 Spec 已修订：

| 条 | 问题 | 处理 |
|---|---|---|
| 1（阻断） | 读查询没把修订文件绑到固定的一代 | 文件带 `generation`，读者只认与固定下来的一代相同的 |
| 2（阻断） | 写入窗口里书被换代，旧写入污染新书 | 同上：旧代遗留的文件代号不符，不会被读到也不会被继承；写前写后各核对一代；Spec 写明 |
| 3 | `wx` 直接写正式文件名，崩溃留下半个最高版本 | 临时文件写完整再 `fs.link` 发布；读不出的最高版本跳过并回退 |
| 4 | 驳回只清了三类引用 | 引用清理表加 `knowledge.about`、`question.updates.answer`、`statement.secret`，加数据集级引用完整性检查 |
| 5 | `origin` 被严格的草稿 schema 拒绝 | `origin` 不进草稿（也不改发给模型的文字）：抽取记录记说法编号，编书时补 `origin` |
| 6（阻断） | `stale` 没有“重新确认”操作，重抽入口也不存在 | 现实里改编号只有整理合并（`mergedFrom`）：按它跟随；对不上的只能丢弃（`undo`）；去掉“重抽”与“重新确认”的承诺 |
| 7 | 挪称呼的时间与重名规则没定 | Spec 写明：`to` 在依据位置加一条非主名、同文字不重复、`from` 去掉不早于依据位置的记录；一个纯函数同时生成称呼表与出现 |
| 8 | 清理旧版本可能删掉别人的更新版本 | 只删版本严格小于自己发布的；`ENOENT` 当作已被回收 |
| 9 | 列表的输入是原始图还是套用后的图没定 | 从原始图与修订文件算，状态优先级 `stale` > 决定 > `closed` > `pending`（Spec 输出 16） |
| 10 | 计划引用了不存在的导航文件，也没有查依据段的方法 | 改为 `BookFrame.vue`；新增读方法 `revisions.evidence`（Spec 输出 15） |
| 11 | 验收映射没有崩溃与换代竞态 | 补真实子进程用例：发布前被杀、发布后清理前被杀、版本交错、写入检查后换代、最高版本损坏 |
| 12（建议） | `book.info` 每次现算无成本边界 | 计数按 `(索引, 阅读位置)` 缓存；100 章样例量一次，目标不超过 50 毫秒 |

另：审查认可 `applyOverlay` 接在 `settle` 之前、对象种类只经 `projection` 读取（未发现绕过的查询）、游标失效的前端收口，以及“不做”各项。

## 实施（2026-10-28，分支 `feat/w00024-t38-overlay-revisions`）

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `fa800b0b7` | `core/overlay/`：修订文件结构、锚、`applyOverlay`、待确认列表；`BookIndex` 与 `projection` 接线（对象种类按位置）；`displayName` 抽到 core |
| 2 | `99b3c66c7` | 修订文件的读写（临时文件加硬链接发布）、写入方法与读方法、`book.info.revisions`、游标绑定修订版本、错误码 R1 到 R5；跨进程并发写入用真实子进程测 |
| 3 | `5ff370645` | `nbstory revisions`、抽取汇总的待确认数、马甲核对说法的 `origin`、Skill 文字 |
| 4 | 见分支 | 待确认页、人物卡候选块、“⋯”菜单与三个修订对话框、导航角标（手机在“更多”）、`e2e/revisions.e2e.ts` |

实施中与计划不同的几处（计划与 Spec 已同步改）：

- 旧版本保留最近 50 个而不是只留最新：跨进程并发写入的测试里，较早写入者晚到、把已被回收的版本号当空位重新发布，覆盖了别人的写入（八个进程里出现过两个版本 3）。
- 列表项多了 `entities`（涉及的对象）与 `quote`（依据原文），`revisions.list` 多一个 `entity` 筛选：人物卡要按对象找自己的候选，卡片要直接显示依据原文。
- 网页进度不单独写“N 条待确认”，网页里是导航“待确认”的角标；命令行汇总照写。
- 手机宽度的“待确认”在“更多”里，“更多”带点（沿用 viewer 输出 33）。

验证：nb-story 单测、类型检查、`e2e/revisions.e2e.ts` 4 条通过（全量 e2e 与审查见下）。

## 下一步

全量 e2e、`book.info` 计数的耗时量一次、实现审查（后端 omp、前端 Sonnet）、处理审查后合入 master。
