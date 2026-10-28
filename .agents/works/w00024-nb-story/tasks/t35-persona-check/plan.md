# t35 计划：抽取管线加“马甲核对”

第 2 版（2026-10-28），按设计审查修订：omp 审到第 7 条时额度用完（[报告](evidences/design-review.txt)），剩余重点改派 Claude Opus（[报告](evidences/design-review-opus.txt)）。各条怎么处理见 README。

## Context

开发者 2026-10-27 反馈：魔女学院里“银色闪光”（茶会账号）就是“银空”，图里没连上。[t33](../t33-graph-issue-reports/README.md) 的实验说明，逐章顺带报告与事后扫描都不合适；[t34](../t34-persona-link-probe/README.md) 证明“程序圈出没连上的马甲、模型答一个窄问题”可行：揭示后 15 个用例两遍都找回了，多数在揭示后第 1 次问到时，最晚第 5 次，揭示前 18 次没有一次提前确定，每次约 ¥0.003。它的风险是称呼全是泛称的马甲会被乱连，而且有“确定”的错连。开发者 2026-10-28 同意按 t33、t34 的建议用 autonomous-delivery 推进。

依据：[`story.ingest`](../../../../../docs/specs/story/ingest.md)（输出 4、5、10、13、14、18、19，“输入与前置条件”的配置）；规则 [`rules.md`](../../../../../packages/nb-story/src/ingest/rules.md)（马甲与 identity、`certainty: candidate`）；泛称 `core/generic-names.ts`（t31）。

工作方式：代码在 `.worktree/w00024-t35-persona-check`（分支 `feat/w00024-t35-persona-check`）；Spec 与 Task 记录在主工作区。

## 技术选型

无新的通用问题。模型调用、重发与记账沿用 `ingest/chapter.ts` 的 `asker` 与 `callModel`；配置沿用 `ingest.recall` 的写法；泛称用 `isGenericName`、`allGeneric`。

## 关键设计

### 行为（Spec 新增输出 20）

每章写完草稿、核对修复与兜底丢弃之后、整理与提交之前，做一次马甲核对：

1. **候选的马甲**（程序选）：加上本章草稿后编出的书里，截至本章末的马甲（kind persona），排除：
   - 已经有身份说法连到某个人物或马甲的（不论确定还是候选，也不论是抽取写的还是核对写的）：答出过一次就不再问，与 t34 的“答出就停”回放一致，也保证同一对马甲不会被重复写（审查第 4 条）；
   - 称呼全是泛称的（`allGeneric`）；
   - 之前的章里核对答过 `not-persona` 的（从已提交各章的抽取记录读）。
2. **触发**：它的某个非泛称称呼（`isGenericName` 为假、至少两个字）出现在本章原文里，或者本章新建了人物或马甲（含它自己）。同一章至多问 5 个；排序先按上一次被问的章（没问过的最前，从已提交各章的抽取记录读），再按对象编号，保证超出名额的马甲在后面的章里轮得到（审查第 4 条）。
3. **问法**：一次一个马甲，材料与 t34 `probe.ts` 相同：这个马甲（编号、类别、称呼与位置、标签）、涉及它的说法（带类别、断言、确定度、挂靠对象、说话人、出处）、本章之前它的称呼出现过的段落（命中段加前后各一段，合并后取最近 12 段）、本章原文全文、候选（截至本章的全部人物与马甲，去掉它自己）。推理档 `medium`。回复多一项 `current`：本章原文里能支持这个结论的段落（审查第 5 条），系统提示词写明“只填本章的段号，本章没有就写空数组”。回复 `{"verdict": "same | not-persona | unknown", "entity", "certainty", "evidence", "current", "reason"}`；不是 JSON 或 verdict 不在三者之内算不成形，按输出 10 重发一次，仍不成形时这个马甲这一章跳过，问题记进这一章（不让这一章失败）。
4. **写入**：`verdict` 为 `same`、`entity` 是候选里的对象、`current` 里至少有一个本章真实存在的段号时，在本章草稿里加一条说法：family `identity`，about 为 [马甲, 对象]，`certainty: candidate`（不论模型写的是 certain 还是 candidate），出处为 `current` 里的本章段落，渠道 narrator，`basis: inferred`，`reason` 写模型的理由，`tier: 2`。
   - **不剧透**（审查第 2 条，阻断）：说法的成立位置是出处的最后一段（编译的规则）。设这个位置为 P：马甲与对象都必须在 P 或之前已建；文字由程序写成“{马甲在 P 的显示名}可能就是{对象在 P 的显示名}。”，显示名用 `ingest/context.ts` 的 `displayName(entity, P)`（只取 P 及之前成立的称呼）。对象在 P 之后才建时不写，记为“依据早于对象出现，跳过”。
   - 编号接着本章已有的说法编号。加入后整份数据编译出错、或编译报出这条说法的称呼剧透警告（`name-leak`）时，去掉这条，问题记进这一章。
   - **不挡整理的合并**（Opus O2）：对象也是马甲、且与这个马甲有相同的称呼时不写（那多半是同一个账号建重了，留给整理合并；身份说法会让整理拒绝合并它们）。
5. **其余回答**：`not-persona` 与 `unknown` 不改数据；`not-persona` 在这一章的说明里记一句“{称呼}（{编号}）可能不是马甲”，之后不再问它。没写下的 `same`（缺本章依据、对象晚于依据）也记一句。
6. **失败**（Opus O3、O4）：渠道失败与其它步骤相同（输出 9：重试用完以 `model_failed` 停下，这一章不提交，接着抽时整章重做）。两次不成形的回复按“章-persona-马甲编号”留存，互不覆盖。进度里每章只在开始核对时报一次“核对马甲”。
7. **开关**：配置 `ingest.personaCheck.enabled`，默认开（布尔，`false` 关）。默认值只在配置解析处（`qa/config.ts`）决定，命令行 `nbstory ingest` 与独立服务的 `ingest.start` 两个入口读配置并显式传进抽取（审查第 1 条）。用抽取的模型与它的单价记费用。
8. **记录**：抽取记录里每章记下 `personas: {asked: string[]; linked: string[]; notPersona: string[]}`，供第 1、2 条的“问过”“答过不是马甲”使用；整章作废重做时不记（重做的那一次重新问）。旧的抽取记录没有这一项，当作空。

### 泛称：复合泛称（审查第 3 条）

t34 里错连的“志愿者学姐”由两个泛称拼成，现有 `isGenericName` 只认整个词相等。改 `core/generic-names.ts`：整个词能完全切成泛称词表里的词（例如“志愿者”+“学姐”）也算泛称；带专名的“墨学姐”切不完，不算。这同时改变查询侧（[`story.queries`](../../../../docs/specs/story/queries.md) 输出 22：这类称呼不计出场、对象可能变成无名），一并改 Spec 与 `generic-names` 的测试，记入待确认清单。

### 为什么只写候选（待确认清单）

t34 里答 same 且写 certain 的 88 次中错了 8 次，全部是两位志愿者学姐（Opus O5）；复合泛称（上一节）补上后她们不会再被问到，其余 80 次确定的回答都对。仍只写候选，因为写错的确定连接现在没有办法改回：合同里没有改说法的写方法，覆盖层还没做，主抽取也不会回头改；而只有 22 个用例，过滤规则又是照着那两次错连补的。后果要写明：开发者报的“银色闪光与银空”做完之后，在查询里显示为“可能是同一人”，两者不合并（[`story.queries`](../../../../docs/specs/story/queries.md) 输出 3）。改回“按模型给的确定度写”只改写入的一行；覆盖层或“用户确认候选”做出来之后再议。

### 代码

- `src/ingest/persona-check.ts`（新）：`pickPersonas(dataset, chapter, paragraphs, newEntityIds): Entity[]`、`personaRequest(dataset, persona, chapter): {system, user}`、`parseVerdict(json)`、`toStatement(...)`；系统提示词放这里（与 t34 `probe.ts` 的 SYSTEM 相同，抽取规则全文不带）。
- `src/ingest/chapter.ts`：`Step` 加 `"persona"`，`STEP_NAMES` 加“核对马甲”；`ChapterRun` 加 `personaCheck?: boolean`（不给时不做，与 `recallEndpoint` 同理，回放测试不受影响）；`extractChapter` 在兜底丢弃之后、最后一次编译之前调用；`ChapterResult` 加 `personas: {asked: number; linked: string[]; skipped: string[]}`，`notes` 照旧。
- `src/ingest/job.ts`、`runner.ts`、`start.ts`、`worker.ts`：把开关从配置传到 `ChapterRun`；抽取记录里每章记下 `personas`。
- `src/qa/config.ts`：`personaCheckEnabled(config): boolean`（默认 true）。
- `src/contract/config-schema.ts`：`ingest.personaCheck: {enabled?: boolean}`（`x-form` 标“核对马甲”）。
- `src/contract/contract.ts`：`ingest.status` 的 `step` 枚举加 `"persona"`。
- `src/web/shell/IngestPage.vue`、`src/web/host/ingest.ts`：`STEP_LABELS` 加“核对马甲”；进度的步骤列表与 recall 的处理相同，只在当前步骤是 `persona` 时多这一格（审查第 6 条：状态里没有本次任务开没开，不全程显示）。
- `testing/ingest-replay.ts`：保留“没有录音的请求即失败”（审查第 7 条）。旧的回放场景经配置走默认开的入口（`runner.test.ts`、`cli/ingest.test.ts`、`server/ingest.test.ts`、e2e）显式写 `ingest.personaCheck.enabled: false`；新场景用测试里的覆盖函数，按章、马甲编号回指定的回答，回放键在 `persona` 步骤多带马甲编号（经请求头 `X-Nbstory-Step` 的标签）。
- `src/cli/ingest.ts`、`src/server/ingest-service.ts`：读 `personaCheckEnabled(config)` 并传进 `startIngest`（审查第 1 条）。

### 测试（`persona-check.test.ts`、`chapter.test.ts`、`runner.test.ts`、`cli/ingest.test.ts`、`server/ingest.test.ts`）

- `persona-check.test.ts`：候选选择（已有确定或候选身份说法的、全泛称的、答过不是马甲的不选；泛称不触发；本章新建触发；每章至多 5 个，按上次被问的章轮换）；请求里没有本章之后的位置；回复解析（不成形、对象不在候选、`current` 为空或段号不在本章）；写入的文字与位置（依据早于对象出现时不写；显示名取依据位置的）。
- `generic-names` 的测试：“志愿者学姐”是泛称，“墨学姐”不是。
- `chapter.test.ts`：开着时对某个马甲回 `same` 且给本章依据：本章草稿多一条候选身份说法，提交的书里两者有候选身份连接、没有确定连接；**在依据段落之前的阅读位置查 `entity.statements`，看不到这条说法与它的文字**（不剧透）；回 `not-persona`：说明里有一句、数据不变；回不成形两次：这一章照常提交、问题记进这一章；关着：不发这一步的请求，请求基线逐字不变。
- `runner.test.ts`：开着时 `same` 写下后，下一章不再问这个马甲；在核对请求中途停止：这一章不提交，接着抽重做这一章时重新问、只写一次；渠道失败重试用完以 `model_failed` 停下；进度里有 `persona` 步骤与费用；关着时没有。
- `cli/ingest.test.ts`、`server/ingest.test.ts`：各验一次默认开（发了 `persona` 请求）与配置里显式关（没发）。

## Spec 与文档改动

- `docs/specs/story/queries.md` 输出 22：泛称的判定加“能完全切成泛称词的复合词”。
- `docs/specs/story/ingest.md`：输出 4 的步骤里提一句马甲核对；新增输出 20；“输入与前置条件”的配置加 `ingest.personaCheck`；输出 13 的步骤与输出 14 的命令行进度；验收与 Smoke 加一条确定性场景；证据补批准依据（t33、t34 与开发者 2026-10-28 的同意）。先以条目级“（planned）”写，实现后去掉。
- `packages/nb-story/README.md` 与 `docs/` 里的配置说明（有的话）加 `ingest.personaCheck`。
- 规则 `rules.md` 不改：抽取规则已经写了“原文没有明确说是同一个个体、只是猜测时写 identity 并标 candidate”。

## 切片

1. **核心**：复合泛称（`generic-names.ts` 与测试、queries Spec 输出 22）；`persona-check.ts` 与单测；`chapter.ts` 的接入与 `chapter.test.ts`；Spec 输出 20（planned）。
2. **接线**：配置、命令行与独立服务两个入口、job、runner、worker、合同的步骤枚举、抽取记录的 `personas`；`runner.test.ts`、`cli/ingest.test.ts`、`server/ingest.test.ts`；回放的 `persona` 步骤与旧场景显式关。
3. **网页与文档**：`IngestPage.vue` 与 `web/host/ingest.ts` 的步骤、配置表单（schema 自动出）、README；受影响的 e2e。
4. **真实模型小抽取**（Opus O1：`compile` 只吃逐章草稿，不能从最终图接着抽，改为全程经产品管线）：从 t33 的 `graph-164.json` 的 `sources` 拼回魔女学院前 20 章原文，先 `--preview` 确认切出 20 章；在临时书库里关着核对（`ingest.personaCheck.enabled: false`）抽第 1 到 16 章，再交前 20 章的原文追加第 17 到 20 章、打开核对；样例书前 10 章开着核对抽一遍。判据看提交后的书经公开查询的结果（`entity.card`、`entity.statements`）：银色闪光与银空有没有候选身份连接、样例书有没有错连。模型 gpt-6-luna，预计约 ¥2.5（按 t32 的小抽取单价）。注意主抽取这次用的是 luna，可能自己就连上了银色闪光；那样核对就不会问它，结果照实记。

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
