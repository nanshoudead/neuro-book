# t35 计划：抽取管线加“马甲核对”

## Context

开发者 2026-10-27 反馈：魔女学院里“银色闪光”（茶会账号）就是“银空”，图里没连上。[t33](../t33-graph-issue-reports/README.md) 的实验说明，逐章顺带报告与事后扫描都不合适；[t34](../t34-persona-link-probe/README.md) 证明“程序圈出没连上的马甲、模型答一个窄问题”可行：揭示后 15 个用例两遍都在第 1 到 3 次问到时找回（多数第 1 次），揭示前 18 次没有一次提前确定，每次约 ¥0.003。它的风险是称呼全是泛称的马甲会被乱连，而且有“确定”的错连。开发者 2026-10-28 同意按 t33、t34 的建议用 autonomous-delivery 推进。

依据：[`story.ingest`](../../../../../docs/specs/story/ingest.md)（输出 4、5、10、13、14、18、19，“输入与前置条件”的配置）；规则 [`rules.md`](../../../../../packages/nb-story/src/ingest/rules.md)（马甲与 identity、`certainty: candidate`）；泛称 `core/generic-names.ts`（t31）。

工作方式：代码在 `.worktree/w00024-t35-persona-check`（分支 `feat/w00024-t35-persona-check`）；Spec 与 Task 记录在主工作区。

## 技术选型

无新的通用问题。模型调用、重发与记账沿用 `ingest/chapter.ts` 的 `asker` 与 `callModel`；配置沿用 `ingest.recall` 的写法；泛称用 `isGenericName`、`allGeneric`。

## 关键设计

### 行为（Spec 新增输出 20）

每章写完草稿、核对修复与兜底丢弃之后、整理与提交之前，做一次马甲核对：

1. **候选的马甲**（程序选）：加上本章草稿后编出的书里，截至本章末还没有确定身份连接的马甲（kind persona；确定连接按产品的 `identityLinkOf`：identity、非否定、about 恰好两个已知对象、certain、fact 或 belief）。跳过称呼全是泛称的（`allGeneric`）。
2. **触发**：它的某个非泛称称呼（`isGenericName` 为假、至少两个字）出现在本章原文里，或者本章新建了人物或马甲（含它自己）。同一章至多问 5 个，按称呼在本章出现的先后、再按对象编号排；超出的这一章不问（下一章再触发时再问）。
3. **问法**：一次一个马甲，材料与 t34 `probe.ts` 相同：这个马甲（编号、类别、称呼与位置、标签）、涉及它的说法（带类别、断言、确定度、挂靠对象、说话人、出处）、本章之前它的称呼出现过的段落（命中段加前后各一段，合并后取最近 12 段）、本章原文全文、候选（截至本章的全部人物与马甲，去掉它自己）。推理档 `medium`。回复 `{"verdict": "same | not-persona | unknown", "entity", "certainty", "evidence", "reason"}`；不是 JSON 或 verdict 不在三者之内算不成形，按输出 10 重发一次，仍不成形时这个马甲这一章跳过，问题记进这一章（不让这一章失败）。
4. **写入**：`verdict` 为 `same`、`entity` 是候选里的对象、`evidence` 里至少有一段在本章时，在本章草稿里加一条说法：family `identity`，about 为 [马甲, 对象]，`certainty: candidate`（不论模型写的是 certain 还是 candidate），出处只取 `evidence` 里本章的段落，渠道 narrator，`basis: inferred`，`reason` 写模型的理由，`tier: 2`，文字由程序写成“{马甲当前称呼}可能就是{对象当前称呼}。”。编号接着本章已有的说法编号。加入后整份数据编译出错时，去掉这条，问题记进这一章。
5. **其余回答**：`not-persona` 与 `unknown` 不改数据；`not-persona` 在这一章的说明里记一句“{称呼}（{编号}）可能不是马甲”。
6. **开关**：配置 `ingest.personaCheck.enabled`，默认开（布尔，`false` 关）。用抽取的模型与它的单价记费用。

### 为什么只写候选（待确认清单）

t34 里志愿者学姐被确定地连到洛萱，两遍都出现；候选身份说法不会让查询把两个对象当成同一个人，查看器里显示为“可能是同一人”。之后的抽取（读到已有的候选）或用户可以改成确定。这是产品取舍，写进待确认清单：改回“按模型给的确定度写”只要改写入的一行，但错连会进确定的身份连接。

### 代码

- `src/ingest/persona-check.ts`（新）：`pickPersonas(dataset, chapter, paragraphs, newEntityIds): Entity[]`、`personaRequest(dataset, persona, chapter): {system, user}`、`parseVerdict(json)`、`toStatement(...)`；系统提示词放这里（与 t34 `probe.ts` 的 SYSTEM 相同，抽取规则全文不带）。
- `src/ingest/chapter.ts`：`Step` 加 `"persona"`，`STEP_NAMES` 加“核对马甲”；`ChapterRun` 加 `personaCheck?: boolean`（不给时不做，与 `recallEndpoint` 同理，回放测试不受影响）；`extractChapter` 在兜底丢弃之后、最后一次编译之前调用；`ChapterResult` 加 `personas: {asked: number; linked: string[]; skipped: string[]}`，`notes` 照旧。
- `src/ingest/job.ts`、`runner.ts`、`start.ts`、`worker.ts`：把开关从配置传到 `ChapterRun`；抽取记录里每章记下 `personas`。
- `src/qa/config.ts`：`personaCheckEnabled(config): boolean`（默认 true）。
- `src/contract/config-schema.ts`：`ingest.personaCheck: {enabled?: boolean}`（`x-form` 标“核对马甲”）。
- `src/contract/contract.ts`：`ingest.status` 的 `step` 枚举加 `"persona"`。
- `src/web/shell/IngestPage.vue`：进度的步骤列表在开着时多“核对马甲”一格（与 recall、consolidation 的处理相同）。
- `testing/ingest-replay.ts`：`ReplayStep` 加 `"persona"`；录下的回复里没有这一步，回放时默认回 `{"verdict":"unknown"}`（可被测试的覆盖替换），使旧的回放在开关打开时照常可跑。

### 测试（`chapter.test.ts`、`persona-check.test.ts`、`runner.test.ts`）

- `persona-check.test.ts`：候选选择（已连的、全泛称的不选；泛称不触发；本章新建触发；每章至多 5 个）；请求里没有本章之后的位置；`toStatement` 的字段；回复解析（不成形、对象不在候选、证据不在本章）。
- `chapter.test.ts`：开着时，回放端点对某个马甲回 `same` 并给出本章证据：本章草稿多一条候选身份说法，提交的书里两者有候选身份连接、没有确定连接；回 `not-persona`：说明里有一句、数据不变；回不成形两次：这一章照常提交、问题记进这一章；关着：不发这一步的请求，请求基线逐字不变。
- `runner.test.ts`：配置默认开时进度里出现 `persona` 步骤与费用；`enabled: false` 时没有。

## Spec 与文档改动

- `docs/specs/story/ingest.md`：输出 4 的步骤里提一句马甲核对；新增输出 20；“输入与前置条件”的配置加 `ingest.personaCheck`；输出 13 的步骤与输出 14 的命令行进度；验收与 Smoke 加一条确定性场景；证据补批准依据（t33、t34 与开发者 2026-10-28 的同意）。先以条目级“（planned）”写，实现后去掉。
- `packages/nb-story/README.md` 与 `docs/` 里的配置说明（有的话）加 `ingest.personaCheck`。
- 规则 `rules.md` 不改：抽取规则已经写了“原文没有明确说是同一个个体、只是猜测时写 identity 并标 candidate”。

## 切片

1. **核心**：`persona-check.ts` 与单测；`chapter.ts` 的接入与 `chapter.test.ts`；Spec 输出 20（planned）。
2. **接线**：配置、job、runner、worker、合同的步骤枚举、抽取记录；`runner.test.ts`；回放的 `persona` 步骤。
3. **网页与文档**：`IngestPage.vue` 的步骤、配置表单（schema 自动出）、README；受影响的 e2e。
4. **真实模型小抽取**：用 gpt-6-luna 抽魔女学院第 17 到 20 章（从开发者的图截到第 16 章作为已提交的书，见下）与样例书前 10 章，看是否连上银色闪光与银空、样例书是否有错连；记费用。

第 4 片的前提：nbstory 的抽取要从第 1 章开始，没有“从一份已有的图接着抽”的入口。做法是在脚本里直接调 `extractChapter`（prior 用 t33 的截断图，`compileWith` 用截断图的编译加候选草稿），只验证这一步的行为，不经书库。若 `compileWith` 无法从最终图构造，改为只抽样例书前 10 章，魔女学院的银色闪光以 t34 的结果为准。

## 验收映射

- 输出 20 → `persona-check.test.ts`、`chapter.test.ts` 的开着、关着、不成形三组；配置默认开 → `runner.test.ts`。
- 输出 4、10 不变（关着时的请求基线逐字不变）→ `chapter.test.ts` 的回放。
- 真实效果 → 第 4 片的小抽取（证据 `evidences/extract.md`）。

## 验证

- `bun run test:affected`（nb-story），`bun run typecheck`；受影响的 e2e（抽取进度页）；收口跑 nb-story 全量单测与 e2e。
- 第 4 片的真实模型小抽取，费用按 deepseek-flash 低谷价记。

## 不做与风险

- 不做“不是马甲”的自动改种类（t34 里这种回答太少）。
- 不回头核对已提交的章：只在新抽的章里问；已经抽完的书要等追加新章时才会被核对。给已有的书补核对属于“事后扫描”，留给覆盖层那一类 Task。
- 每章多 0 到 5 次请求；按 t34 的触发频率，样例书 100 章约多 ¥1.8。
