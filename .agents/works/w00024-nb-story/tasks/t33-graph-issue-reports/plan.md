# t33 计划：抽取时报告图问题、另一个 agent 修复的实验

## Context

开发者 2026-10-27 在 [t21](../t21-usage-feedback/README.md) 的魔女学院反馈里提出：图问题（马甲和本人没连、泛称当成人物、关系标错）往往到后面几章才暴露，让后面的抽取者在抽本章时顺带报告，再由另一个 agent 专门修。开发者说这个方向要先做实验取得支持；2026-10-28 定先做这件事（t21 里的实验草案三步：检测、修复、对照）。

[t31](../t31-graph-quality-program/README.md) 已经在程序侧处理了泛称不计出场、无名对象、亲属兜底词；银色闪光与银空的归并它解决不了，留给抽取侧或修订层。本 Task 只做实验，不改产品代码与 Spec（行为合同未变）。实验结论决定后续是否把报告接进管线、修复以什么形式落地（与“用户手工修订层”共用覆盖层），那是另外的 Task。

数据：开发者经 ssh 给的《老师，男生也能报考魔女学院吗？》图（`graph-164.json`，164 章，V9，含原文），本机在 `/tmp/t31/`，实验时拷到 `.local/agent/works/w00024-nb-story/tasks/t33-graph-issue-reports/data/`（不入库）。模型 gpt-6-luna（已授权，密钥只经环境变量从仓库根 `.env` 的 `JIJI_LUNA_*` 读）。

要回答的问题：

1. 抽取者在抽第 k 章时，能不能报出已有记录里的问题？报得准不准、最早在第几章报出？
2. 顺带报告（和写草稿同一次调用）会不会拖累草稿本身？多花多少输出？
3. 单独一步报告（共用同一个开头，吃前缀缓存）和顺带报告比，哪个更合算？
4. 只看图、抽完后扫一遍（不读原文），能发现多少？
5. 独立的修复 agent 拿到报告，能不能给出正确、可以套用的修订？

## 技术选型

- 模型调用：复用 `packages/nb-story/src/ingest/model.ts` 的 `callModel`（渠道重试、用量、`finishReason` 与产品一致），不另写 fetch。
- 已有记录与原文的写法：复用 `ingest/context.ts` 的 `renderContext` 与 `ingest/prompts.ts` 的 `systemV2`、`prefixFor`、`draftTask`，这样实验里的“抽取者”看到的东西与产品管线逐字相同。
- 泛称判断：复用 `core/generic-names.ts` 的 `isGenericName`、`allGeneric`。
- 套用修订后的检查：复用 `core/dataset.ts` 的 `validateDataset`，再用核心库建一次索引、查一次（证明修订后的图能被查看器与问答读）。
- 脚本放 Task 的 `scripts/`，跨包按相对路径引 nb-story 源码（与 t28、t32 的实验脚本相同）。没有通用问题要另选库。

## 关键设计

### 金标：`evidences/gold.md`（先做、先提交，跑模型之前冻结）

范围是前 30 章已有记录里的问题。来源两条：程序扫描出候选（下一节），我逐条回原文核实。每条写：编号、类型、涉及的记录 id、依据段落、最早在第几章能看出来、期望的修法。已经看到的几条：

- 银色闪光（`e18-1`，persona）与银空（`e19-1`）没有 identity 说法；第 18 章写银色闪光银发、第 19 章银发的银空来教飞行，`s25-1` 还把“银空说”挂在 `e18-1` 上。期望：补一条 identity。
- `s2-7` 记成 identity，内容是“星瑕认为招生老师对自己做了手脚”，不是身份。期望：改类别。
- `e10-4` “称号魔女”是一类身份，建成了 persona。期望：改种类。
- `e4-1`、`e4-2` 两个“志愿者学姐”、`e16-1`“女人/小姨”、`e16-2`“母亲”：只有泛称，建成 persona 或 person。期望：按 t31 的无名对象对待，persona 改 person。

模型后来报出、金标里没有的，事后逐条判“金标漏了、成立”或“误报”，冻结金标与补充后的两组数字都报。

### 程序扫描：`scripts/scan.ts`

零成本的对照组，也是金标的候选来源：全泛称的对象；没有 identity 说法相连的 persona；identity 说法的文字里没有身份词（复用 `reconcile.ts` 的 `IDENTITY_HINT` 思路，脚本里照抄正则并注明出处）；同一称呼挂在两个对象上；原文里像揭示身份的段落（同一个正则）有没有 identity 说法引用。

### 检测：`scripts/detect.ts`

每章的“已有记录”用 `renderContext(graph, k-1, {text})`，原文用 `prefixFor`。先做一次截断核对：把图截到第 k-1 章（按 `at` 去掉之后的记录）再渲染，与直接渲染的文字逐字相同，才说明没有把后文带进去；不同就改用截断后的图。

报告的形状（三组共用）：

```json
{"graphIssues": [{"type": "alias-link | same-entity | wrong-name | generic-entity | wrong-kind | wrong-family | other",
  "records": ["e18-1", "e19-1"], "evidence": ["19.34", "18.17"], "claim": "一句话", "confidence": "high | medium | low"}]}
```

只报“已有记录”里的问题，不报本章自己新写的记录；`evidence` 只能引本章与之前的段落。没有就写空数组。

| 组 | 做法 | 章 | 遍数 |
|---|---|---|---|
| A0 | 产品原样的写草稿调用（对照，不加任何东西） | 18 到 30 | 1 |
| A 顺带 | 同一次写草稿调用，`draftTask` 末尾加一段要求多输出 `graphIssues` | 18 到 30 | 2 |
| B 单独一步 | 共用同一开头，【任务】只要 `graphIssues` | 18 到 30 | 2 |
| C 只看图 | 第 30 章末一次，`renderContext(graph, 30)` 不带原文，只要 `graphIssues` | 30 | 2 |
| P 程序 | `scan.ts` | 30 | — |

推理档与产品写草稿相同（`medium`）。A、A0 的草稿只用来比较，不提交、不编译进图；同一章 A 与 A0 比记录条数（按类）、输出 token。原始回复与用量写进 `.local` 的 `runs/<组>-<遍>/`，失败的调用重跑同一章，不跳章。

### 修复：`scripts/repair.ts`

输入：A、B、C 报出的问题去重后、判为成立的每一条；附上涉及的对象（种类、称呼、标签）、相关说法与依据段落前后各两段。输出覆盖层形式的修订，每条带理由与依据段落：

- `addStatement`（只允许 identity 一类，字段与草稿的说法相同）、`setEntityKind`、`setStatementFamily`、`moveName`、`removeName`、`mergeEntities`、`reject`（判断这条报告不成立）。

`repair.ts` 把修订套到图的副本上（脚本内的最小实现，不进产品），再 `validateDataset` 并建索引查 `entity.card`。每条修订按金标的期望修法判“对、部分对、错、有害”（有害：改坏了原本对的记录）。一遍。

### 报告：`scripts/report.ts`

每组：金标召回（按类型）、准确率（成立的报告 ÷ 全部报告）、每条金标最早在第几章报出、两遍的交集与并集、每章多出的输出 token 与费用（按 deepseek-flash 低谷价折算）；A 对 A0 的草稿条数差。修复：各判定的条数，套用后能否通过检查。

## Spec 与文档改动

无。Task README 写“行为合同未变”。

## 切片

1. **数据与金标**：拷数据；`scan.ts`；截断核对；写 `evidences/gold.md` 并提交（之后不再改，补充的另记）。
2. **检测**：`detect.ts --dry`（只构造请求、估算 token）对过请求文字后，跑 A0、A、B、C；原始结果在 `.local`。
3. **检测评分**：`report.ts`，结果与判定写进 `evidences/detection.md`。
4. **修复**：`repair.ts`，结果写进 `evidences/repair.md`。
5. **结论**：README 写回答五个问题的结论与建议（接进管线用哪一组、修订层要支持哪几种操作），有长表时用 nbdev 发 `report` 产物。

每片完成后提交 Task 目录（脚本、证据、README），路径限定。

## 验收映射

不对应 Spec 条目。判据是上面五个问题各有数字回答，且每个数字能用 `evidences/` 里记的命令从 `.local` 的原始结果重算出来。

## 验证

- `detect.ts --dry` 打印每组每章的请求长度；A 的请求与 A0 只差末尾那一段（脚本里断言）。
- 截断核对按章打印“相同”。
- 修订套用后 `validateDataset` 为 null、索引能建、`entity.card` 能查。
- 预算：约 100 次调用，按 t32 的单价估 ¥5 到 ¥10；超过 ¥20 停下报告。

## 不做与风险

- 不改产品代码、提示词与 Spec；不在别的书上重复（结论成立后再说）。
- 图是开发者那边另一个模型抽的，这里用 luna 检测与修复：测的是“在真实的有缺陷的图上能不能发现”，不是 luna 自己抽会不会出同样的错。
- 金标由我（Agent）标，难免漏；用冻结加事后判定两组数字缓解，判定理由逐条写进证据。
- `renderContext` 按本章相关性裁剪已有记录，问题涉及的对象没进上下文时 A、B 报不出来；这本身是结论之一，报告里按“上下文里有没有涉及的记录”分开统计。
- 只有 13 章、两遍，数字只用来判断方向值不值得做，不作产品指标。
