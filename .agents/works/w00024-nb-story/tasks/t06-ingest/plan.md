# t06 计划：导入 TXT 原文并逐章抽取

## Context

- 要做的：把 w00005 t29 的 v2 抽取管线搬进 nb-story，命令行与网页都能导入 TXT、看进度、随时停、接着抽、追加新章，已提交的章随抽随看。
- 依据：[`story/ingest.md`](../../../../../docs/specs/story/ingest.md)（planned，本 Task 写，已按 omp 设计审查修订，报告 [evidences/design-review.txt](evidences/design-review.txt)）、[`story/queries.md`](../../../../../docs/specs/story/queries.md) 的“抽取进度”与 F3、[`story/qa.md`](../../../../../docs/specs/story/qa.md) 的“时序与寿命”与输出 23、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)；网页部分等评审板定稿后写进 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md)。管线设计见 [V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)的“抽取管线”与第十二节第 9 到 11 小节。
- 开发者的决定：[README](README.md) 决定 3 到 8 与会话里确认的八条假设。
- 要搬的代码只在 w00005 的 worktree 里（没有提交过），下文记作 `W5/`，即 `.worktree/w00005-novel-understanding-spike/.agents/works/w00005-novel-understanding-spike/tasks/`：
  - `W5/t29-v9-ingest/v2/`（入口 `run-v2.ts`、`prompts-v2.ts`、`reconcile.ts`；`context-log.ts` 与 `merge-program.ts` 是实验变体，不搬）
  - `W5/t29-v9-ingest/draft-tools.ts`、`prompts.ts`
  - `W5/t27-v9-schema-gold/compile.ts`、`schema.ts`（草稿与整理稿的部分）、`context.ts`、`query.ts`（context 用到的部分）、`rules.md`
  - `W5/t19-eval-question-bank/scripts/luna.ts`（只参照它的“跑飞”判定，不搬）
  - `W5/t33-v9-extraction-v2/`（回归尺子：`scripts/check.ts`、`groups.ts`、`checklist-ch1-20.json`，迁入本 Task 的 `scripts/`）
- 约束：搬的是已验证质量的管线，提示词与“已有记录”的文字逐字不变。和管线不同的只有审查要求的三处（称呼不跨章前移、全图错误也要消除、整体回复不成形时重发一次），都不改模型输入的文字。

## 技术选型

| 通用问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 模型调用 | nb-harness `createHarness`（无工具 Profile、内存会话日志，每次调用一个），`thinkingLevel` 传 `minimal` 或 `medium` | 问答已经走它：密钥读取与脱敏、错误归类（Spec 的 `kind`）、用量、缓存命中与“用量不完整”都现成；`Effort` 含 `minimal`；`subscribe` 拿得到流式文字，用来判“跑飞” | 搬 `luna.ts` 手写客户端（重复写脱敏、归类与用量）；`openai` SDK（仓库没有，同样要自己归类） |
| 草稿与整理稿的校验 | TypeBox（照 `W5/t27…/schema.ts` 的 zod 写法翻） | nb-story 的数据集 schema 已是 TypeBox，一个包里不放两套校验库 | 沿用 zod（根依赖有，但会出现两套） |
| TXT 解码 | `TextDecoder("utf-8", {fatal: true})` | 内置，非 UTF-8 直接抛错，对应 `ingest_bad_text`；网页端同样严格解码再提交文本 | `iconv-lite`、`chardet`（不做别的编码） |
| 一个书 id 一个任务、运行者还在不在 | 复用 serve 的 `flock`（`src/server/registry.ts`，抽成共用模块） | 进程怎么死锁都由内核放掉，“是否在运行”就是“能不能拿到锁”，不靠进程号 | `proper-lockfile`（目录锁加心跳，要判旧） |
| 抽取期间服务不卡 | 任务整个跑在 Bun `Worker` 线程里（命令行与 serve 一样），主线程只收进度、发停止 | 100 章时编译一次实测约 11 秒（审查第 11 条），放主线程会卡住查询与停止；worker 不改编译算法，以后增量化也不动合同 | 主线程分段 `await`（编译是一整段同步计算，切不开）；子进程（多一套进程管理，`owned-process` 是给长驻服务的） |
| 渠道失败的退避重试 | 手写，延迟表与等待函数可注入；只此一层（provider 层的重试关掉或计入） | 规则是一张固定延迟表加按错误归类决定重不重试；测试要注入时钟并数端点实际收到的请求数 | `p-retry`（仓库没有，判定接口包一层更绕） |
| 原子写文件与提交 | 临时目录或文件加 `rename`（`library.ts` 已有的做法） | 同一套保证 | — |
| 网页上传 | 浏览器读文件、严格按 UTF-8 解码，经 RPC 以文本提交（请求体上限 40 MiB） | 现有 RPC 是 JSON；32 MiB 一次放得下；解码失败在浏览器就能报 | multipart（多一条非 RPC 的接口） |
| 网页 | 现有 Vue 3、vue-router、nb-ui | 查看器已用 | — |

## 关键设计

### packages/nb-story/src/ingest/（新）

照搬管线，按职责分模块；搬过来时只改导入路径、类型与 TypeBox，不改逻辑与文字（下文“改”字标出的除外）：

- `text.ts`：`decodeUtf8(bytes)`、`splitChapters(text): {chapters, preambleChars, volumeLines}`，规则逐条照 ingest.md“原文与切章”。
- `draft-schema.ts`：草稿各节与整理稿的 TypeBox schema（`W5/t27…/schema.ts` 第 40 到 245 行）。
- `compile.ts`：`compile(book, sources, drafts, consolidations): {dataset, issues}`，产出 `core/dataset.ts` 的 `Dataset`。来自 `W5/t27…/compile.ts`。**改**：称呼首次出现的前移（原第 378 到 389 行）只在模型标注的那一章之内（ingest 输出 8，提案第十二节第 10 小节的修法）。
- `context.ts`：“已有记录”的生成（`W5/t27…/context.ts` 与它用到的 `query.ts` 函数）。和 `core/projection.ts` 有重叠，但文字要与验证过的管线逐字一致，所以不改用核心的视图；模块头写明理由。
- `draft-tools.ts`、`reconcile.ts`、`prompts.ts`（含 `rules.md` 与虚构示例，作为包内资源）。
- `model.ts`：`callModel({system, user, effort, signal, sleep})`：每次建一个无工具 harness、`turn` 一次；流式文字在一段内容之后连续 2000 个空白即中止，记为跑飞；网络、5xx、超时、跑飞按延迟表重发（同一请求合计至多 6 次 HTTP 尝试，端点计数验证）；`auth`、`quota`、模型拒绝推理档不重发。回复取出 JSON 对象，不成形（不是 JSON、截断、缺本章、没有段落块）时这一步重发一次，仍不成形抛 `ingest_bad_reply`。每次尝试的用量（含 `complete`）与当时的单价写进用量日志。
- `chapter.ts`：一章的四步（`run-v2.ts` 第 170 到 254 行的单章、单份草稿路径），输入是已提交数据集与本章原文，输出最终草稿与问题记录。**改**：结构检查除了本章的问题，还算上编译出的全图错误里这一章新带来的（与提交前的数据集比对），一起进修复与兜底丢弃（审查第 10 条）。
- `store.ts`：抽取记录 `<书库>/.ingest/<书 id>/`：`source.json`（切好的章）、`staged/`（正在抽的一章的中间结果，提交时并入或丢弃）、`committed/<revision>/`（每次提交写一个新目录：截至这一章的全部最终草稿索引与整理结果文件名）、`usage.jsonl`（每次请求一行，只追加）、`state.json`（状态、由谁运行、当前章与步骤、停下的原因）、`lock`（flock）。
- `job.ts`：`runIngest(...)`：拿锁 → 读书的 `extraction.revision` 得到已提交的章 → 从下一章起逐章抽 → 第 5 的倍数与原文末章先做整理 → 提交（见下一节）→ 放锁。只在 worker 里运行。
- `worker.ts` 与 `runner.ts`：主线程侧建 worker、转发进度事件、发停止、等它结束；worker 侧跑 `runIngest`。
- `start.ts`：`planIngest(text, {title, id})`：切章并判断 `new`、`resume`、`append`、`done`，或报 `ingest_text_changed`、`book_exists`；“有这个 id 的抽取记录”按 `.ingest/<书 id>/source.json` 判断，第 1 章没提交的也算。
- `status.ts`：读 `state.json`，并用锁判断是否真的在运行（拿得到锁即“运行它的进程已退出”）。

要守住的不变量：
- 一章的输入只依赖已提交的数据与本章原文：接着抽、追加的结果与一口气抽完相同（回放测试锁定）。
- 唯一的提交点是书目录里 `book.json` 的改名（第 1 章是整个书目录的改名）；`book.json` 里 `extraction: {through, revision}` 是“提交到第几章”的唯一依据。提交的顺序：先写 `committed/<n+1>/` 与新数据文件，再改名替换 `book.json`；改名前被杀，接着抽从 `book.json` 记的章往后，多写的目录与文件下次清理。

### packages/nb-story/src/core/library.ts、cursor.ts、book-index.ts（同一代内更新）

- `BookMeta` 加 `revision`（从 1 起）、`graph`（数据文件名 `graph.<revision>.json`）与可选的 `extraction`；导入的书 `revision` 为 1、不再变。
- 新增 `Library.commitExtraction(id, {dataset, revision, committedDir})`：书不存在时按现有导入流程建目录（临时目录改名，新的一代）；已存在时写新数据文件，再临时文件改名替换 `book.json`，最后删旧数据文件。`pinBook` 先读 `book.json` 再打开它指向的文件：已打开的旧文件删除后照常可读（POSIX），进行中的查询与一问不受影响。
- 书目录的不变量从“从不原地改写”改为“只有 `book.json` 与数据文件按上面的顺序替换”，模块头同步改写。
- 游标、索引缓存的键改为 `(id, generation, revision)`；每次查询照常读 `book.json`，所以别的进程提交后，本进程的新查询拿到新版本。
- `importBook`：`.ingest/<id>/` 存在时得到 `book_exists`；抽取的首次提交在 id 已被导入的书占用时同样失败（两条路都靠书目录改名的排他）。

### 停止与删除

- 命令行：`onProcessInterrupt`（nb-harness 已有）→ 给 worker 发停止。
- serve：进程内 `Map<书 id, Runner>`；`ingest.stop` 与服务停止都走它；服务停止时先停全部任务、等它们放锁，再撤销登记、停监听。
- `book.remove`：先在本进程的 Runner 里停掉这个 id 的任务；再非阻塞地拿这个 id 的抽取锁，拿不到（别的进程在抽）得到 `ingest_running`；拿到后在持锁期间删书目录与抽取记录，再放锁。旧任务一定已经放过锁，不会再写。

### packages/nb-story/src/qa/config.ts、config-edit.ts、cli/config.ts

- schema 加可选 `ingest.model`（不收 `thinking`）；`ingestModel(config)` 返回它或回落到 `model`（去掉 `thinking`）。
- `config set ingest.model '<JSON>'` 整节写入，`ingest.model.<字段>` 只在整节已存在时可改；`config unset ingest.model`。
- `config test --ingest`：用 `ingestModel`，按 `minimal`、`medium` 各发一个最小请求（复用 `qa/probe.ts`，探测改为可传推理档），分别报告。

### packages/nb-story/src/cli/ingest.ts（新）、commands.ts

- `nbstory ingest <文件>`、`--preview`、`--book`、`--status`；进度写标准错误，`--json` 只输出一个 JSON；退出码见 ingest.md 输出 15。命令表加 `ingest`（`preview`、`status` 是开关）。

### packages/nb-story/src/server/、src/contract/contract.ts

- 契约加 `ingest.preview`、`ingest.start`、`ingest.stop`、`ingest.status` 的 schema；`ingest.start` 在 serve 里起 Runner、立即返回。请求体上限对 `ingest.*` 放到 40 MiB。

### packages/nb-story/src/web/（等评审板定稿）

- 书架带状态与进度；导入页、进度页（或按答复的做法）；书里顶栏的抽取徽标与更新方式。新组件的同名 `.md` 与 Lab 登记按 ui-development 的规定。

### 测试数据与脚本

- `testing/fixtures/ingest/source-ch001-008.txt`：样例书前 8 章（来自 `W5/t23-eval-50ch/evidences/source-ch001-100.json`）；切章用的另一份小文本单独写在测试里。
- `testing/fixtures/ingest/replay/`：t34 `run-med-100` 前 8 章录下的模型回复（段落块、草稿、核对、修复、整理）；`testing/replay-endpoint.ts` 按“第几章、哪一步”回放，认不出就让测试失败；可注入 503、401、拒绝推理档、坏 JSON、跑飞、截断，并记下收到的请求数。
- 回放检验“逐字搬过来”：回放前 8 章，最终草稿与 t34 的 `draft.json` 相同；因称呼修正与全图检查而不同的，测试里逐条列出预期差别（不放宽成“大致相同”）。
- 编译检验：用 t34 的 100 章最终草稿与整理稿编译，结果与 t34 的 `dataset-v9.json` 相同，只在称呼位置（与随之变化的称呼出现）上不同，差别逐条列出。
- 回归脚本：t33 的尺子迁入本 Task 的 `scripts/`，接到 nb-story 的抽取结果上。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/viewer.md` | 书架的状态与入口、导入页、进度页、书里的抽取徽标与更新方式（评审板定稿后写） |
| `packages/nb-story/AGENTS.md` | 抽取模块的位置；管线搬自 w00005 t29、t27 的来源与“提示词文字不改”的约束 |

## 切片

1. **S1 搬编译与切章**：`text`、`draft-schema`、`compile`（含称呼修正）、`context`。验证：100 章编译对照（差别逐条列出）；切章（ingest 验收 6）；称呼可见位置的编译加查询部分（验收 7）。
2. **S2 搬单章管线**：`draft-tools`、`reconcile`、`prompts`、`model`、`chapter`，回放端点。验证：回放前 8 章对照；重试、跑飞、不成形、拒绝推理档、用量不完整（验收 5，注入等待，数请求）。末尾用真实 luna 抽 3 章，与 t34 同章的草稿条数、问题数对照，确认经 nb-harness 发请求与直连没有实质差别（`response_format` 等）。
3. **S3 任务与书库**：`store`、`job`、`worker`、`runner`、`start`、`status`，`library` 的提交与版本，游标与缓存键，删除。验证：验收 1 到 4、7、8 的进程内部分；提交各阶段强杀（验收 3）；queries 与 qa 的现有测试不改断言通过。
4. **S4 命令行与配置**：`nbstory ingest`、`ingest.model`、`config test --ingest`。验证：验收 1、2、4、9 走真实命令行进程；qa 输出 23。
5. **S5 服务与网页**：`ingest.*` 方法、serve 内 Runner、网页三处。验证：验收 10（回放 100 章时的服务响应）；e2e（导入、停止、继续、书架状态、书里更新）；前端审查。
6. **S6 真实模型**：前 3 章 smoke（网页，停一次再继续）；前 20 章三次回归（验收 11，约 6 元加判分约 0.3 元）。

每片自跑 `bun test`（nb-story）、`bun run typecheck`；S3 起跑 queries 与 qa 的全部测试。S2、S3 完成后交 omp 实现审查一次，S5 的前端交 Sonnet 审查。S1 到 S6 在同一条 Work 分支上做，按片提交。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| ingest 输出 1 到 3、验收 2、6 | S1、S3、S4 的测试 |
| ingest 输出 4、5、9、10、验收 5 | S2 回放与注入等待的测试 |
| ingest 输出 6、7、11、16、17、验收 1、3、4、8 | S3、S4（进程内与真实命令行） |
| ingest 输出 8、验收 7 | S1 编译加查询；S3 回放 |
| ingest 输出 12、验收 10 | S5 |
| ingest 输出 13 到 15 | S4 命令行测试；S5 网页 e2e |
| queries 抽取进度（时序与寿命、F3、F10） | S3 |
| qa 时序（一问固定抽取进度）、输出 23、ingest 验收 9 | S3、S4 |
| ingest 验收 11 | S6 回归 |
| viewer 的新条目 | S5 e2e（条目编号写 Spec 时定） |

## 验证

- 每片：`bun test`、`bun run typecheck`（nb-story），`bun run docs:check`。
- 端到端：真实书库、`nbstory serve`，网页导入样例书前 3 章、真实模型抽完、中途停一次再继续，查看器里打开；命令行同样走一遍，`--status` 与网页显示一致。
- 留下的未验证边界：几百章以上的耗时与费用（只按 100 章外推；编译时间随章数增长，100 章约 11 秒一次，1000 章可能到分钟级，到时另行增量化）；非 luna 模型的质量；Windows（flock 不支持，serve 已有同样限制）。

## 不做与风险

- 不做：长书费用控制（只带相关记录）；改稿重抽；EPUB、GBK；同一章两份草稿比对；人工修正记录；已导入的 100 章样例书的称呼位置修正（导入的数据文件里已经丢了模型标注的位置，修不回来；重新抽取的书没有这个问题）。
- 风险：经 nb-harness 发请求与 `luna.ts` 直连可能有差别（`response_format: json_object`、流式细节、provider 自带的重试）。S2 末尾实测，差别大就在 `model.ts` 里补齐，不改提示词。
- 风险：编译时间随章数增长，长书每章的提交越来越慢（不影响合同，影响速度）。
