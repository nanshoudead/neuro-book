# t06 计划：导入 TXT 原文并逐章抽取

## Context

- 要做的：把 w00005 t29 的 v2 抽取管线搬进 nb-story，命令行与网页都能导入 TXT、看进度、随时停、接着抽、追加新章，已提交的章随抽随看。
- 依据：[`story/ingest.md`](../../../../../docs/specs/story/ingest.md)（planned，本 Task 写，经两轮 omp 审查修订）、[`story/queries.md`](../../../../../docs/specs/story/queries.md) 的“抽取进度”与 F3、F10、[`story/qa.md`](../../../../../docs/specs/story/qa.md) 的“时序与寿命”与输出 23、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md) 输出 36 到 40 与验收 9。管线设计见 [V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)的“抽取管线”与第十二节第 9 到 11 小节。
- 审查：Spec 审查 [evidences/design-review.txt](evidences/design-review.txt)（15 条），计划审查 [evidences/plan-review.txt](evidences/plan-review.txt)（16 条），都已处理进 Spec 与本计划。
- 开发者的决定：[README](README.md) 决定 3 到 12 与会话里确认的八条假设；跨进程删除改为拒绝（2026-10-20 确认）。
- 要搬的代码只在 w00005 的 worktree 里（没有提交过），下文记作 `W5/`，即 `.worktree/w00005-novel-understanding-spike/.agents/works/w00005-novel-understanding-spike/tasks/`：
  - `W5/t29-v9-ingest/v2/`（入口 `run-v2.ts`、`prompts-v2.ts`、`reconcile.ts`；`context-log.ts` 与 `merge-program.ts` 是实验变体，不搬）
  - `W5/t29-v9-ingest/draft-tools.ts`、`prompts.ts`
  - `W5/t27-v9-schema-gold/compile.ts`、`schema.ts`（草稿与整理稿的部分）、`context.ts`、`query.ts`（context 用到的部分）、`rules.md`
  - `W5/t19-eval-question-bank/scripts/luna.ts`（参照它的流式读法与跑飞判定）
  - `W5/t33-v9-extraction-v2/`（回归尺子：`scripts/check.ts`、`groups.ts`、`checklist-ch1-20.json`，迁入本 Task 的 `scripts/`）
- 工作位置：Work 分支 `feat/w00024-nb-story`（worktree `.worktree/w00024-nb-story`），各片依次提交。
- 约束：提示词与“已有记录”的文字逐字不变。和管线不同的只有 Spec 要求的几处：称呼不跨章前移、回补的知情与秘密读完写下的那一章才可见、全图错误也要消除、整体回复不成形时重发一次；都不改模型输入的文字。

## 技术选型

| 通用问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 模型调用 | `openai` 官方 SDK（v6，依赖树里已有 6.26.0，nb-story 自己声明），`maxRetries: 0`，流式，`reasoning_effort` 与 `response_format` 原样发送 | 能精确控制：SDK 不重试，推理档不改写，流可以随时中止；错误带 HTTP 状态与错误码，归类成 Spec 的 `kind` 只需一张表；用量在流末尾的 `usage` 里（含缓存命中） | nb-harness（计划审查第 4、5 条实测：OMP 在一次调用里自带最多 6 次重试，端点拒绝 `minimal` 时自动降成 `low` 重发，都没有对外开关，违反“只一层重试、不降档”）；手写 fetch 加 SSE 解析（`luna.ts` 那样，SDK 已经做好） |
| 错误归类与脱敏 | 照 `agent/harness.md` 的归类表写一个小函数（状态码、错误码 → `kind`）；错误文字里出现密钥就替换，复用 nb-harness 导出的 `REDACTED_KEY` 记号 | 归类口径与问答一致；表只有七类 | 深导入 nb-harness 内部的 `classifyProviderError`（不是公开入口） |
| 草稿与整理稿的校验 | TypeBox（照 `W5/t27…/schema.ts` 的 zod 写法翻） | nb-story 的数据集 schema 已是 TypeBox，一个包里不放两套 | 沿用 zod |
| TXT 解码 | `TextDecoder("utf-8", {fatal: true})` | 内置，非 UTF-8 直接抛错 | `iconv-lite`、`chardet` |
| 一个书 id 的排他 | `flock`（`src/server/registry.ts` 的做法抽成共用模块），锁文件放在不随书删除的 `<书库>/.locks/<书 id>.lock`，由主线程持有 | 进程怎么死都由内核放锁；锁文件不删，inode 不变，排他域稳定（计划审查第 2、3 条） | 锁放在抽取记录目录里（删除时一起删，会出现两把互不排他的锁）；worker 持锁（worker 被结束时锁不放） |
| 抽取期间服务不卡、停止有界 | 任务跑在 Bun `Worker` 里；停止用 `SharedArrayBuffer` 上的标志位（加一条消息唤醒等待），worker 在每次模型请求前、重试等待中、提交前同步检查；宽限期过后主线程结束 worker | 编译是一整段同步计算（100 章约 10 秒），消息在编译期间送不到（计划审查第 6 条实测 9.5 秒）；标志位在编译一结束、提交之前就能看到；锁在主线程，结束 worker 不会漏锁 | 只靠消息；子进程 |
| 渠道失败的退避重试 | 手写，延迟表与等待函数可注入 | 只有一层、一张固定表；测试注入时钟并数端点收到的请求 | `p-retry`（仓库没有） |
| 原子写文件与提交 | 临时文件或目录加 `rename`（`library.ts` 已有） | 同一套保证 | — |
| 网页上传 | 浏览器读文件字节、先按 UTF-8 严格解码检查，再以 base64 经 RPC 提交；请求体上限 48 MiB | base64 的长度是确定的（32 MiB 原文约 43 MiB），不像 JSON 字符串会因转义翻倍（计划审查第 16 条） | 以文本放进 JSON（最坏翻到 64 MiB 以上）；multipart（多一条非 RPC 接口） |
| 网页 | 现有 Vue 3、vue-router、nb-ui | 查看器已用 | — |

## 关键设计

### packages/nb-story/src/ingest/（新）

照搬管线，按职责分模块；搬过来时只改导入路径、类型与 TypeBox，不改逻辑与文字，下文写“改”的除外：

- `text.ts`：`decodeUtf8(bytes)`、`splitChapters(text): {chapters, preambleChars, volumeLines}`，规则逐条照 ingest.md“原文与切章”。
- `draft-schema.ts`：草稿各节与整理稿的 TypeBox schema（`W5/t27…/schema.ts` 第 40 到 245 行）。
- `compile.ts`：`compile(book, sources, drafts, consolidations): {dataset, issues}`，产出 `core/dataset.ts` 的 `Dataset`。来自 `W5/t27…/compile.ts`。改三处：
  1. 称呼首次出现的前移（原第 378 到 389 行）只在模型标注的那一章之内（ingest 输出 8）；
  2. 知情记录与秘密的 `at` 不早于写下它的那一章的最后一段（原第 229 到 234、264 到 270 行只按出处取，回补时会落回旧章；ingest 输出 5、验收 7）；
  3. 错误（`Issue`）多带一个 `records` 字段，列出涉及的记录 id（时间环列出环上的时间点），兜底丢弃按它找本章的记录，不再从文字里截第一个 id（计划审查第 10 条）。
- `context.ts`：“已有记录”的生成（`W5/t27…/context.ts` 与它用到的 `query.ts` 函数）。和 `core/projection.ts` 有重叠，但文字要与验证过的管线逐字一致，所以不改用核心的视图；模块头写明理由。
- `draft-tools.ts`、`reconcile.ts`、`prompts.ts`（含 `rules.md` 与虚构示例，作为包内资源）。改：`dropOffending` 只按 `Issue.records` 里属于本章草稿的 id 丢，一轮没有进展就停，交回调用方判失败。
- `model.ts`（传输层）：`callModel({system, user, effort, signal, sleep, stop}): {json, usage}`：建 OpenAI 客户端（`maxRetries: 0`）发流式请求；流式文字在一段内容之后连续 2000 个空白即中止，记为跑飞；网络、5xx、超时、跑飞按延迟表重发（同一逻辑请求合计至多 6 次 HTTP）；`auth`、`quota`、`rate_limit` 以外的 4xx（含拒绝推理档）不重发。只负责渠道、流、用量与取出 JSON 对象；每次 HTTP 尝试的用量（拿不到时标不完整）、当时的单价与币种交给调用方记账。
- `chapter.ts`：一章的四步（`run-v2.ts` 第 170 到 254 行的单章、单份草稿路径），输入是已提交数据集与本章原文。各步的回复由这一层按自己的形状判断是否成形：段落块步骤要有本章与段落块；草稿与段落块合并后要是合法的章；核对与修复是补丁（`replace`、`remove`、`rewrite`、`skip`）；整理按整理稿 schema。不成形的这一步重发一次，仍不成形抛 `ingest_bad_reply`；整理不合格不抛，跳过并记进问题。改：结构检查算上编译出的全图错误里这一章新带来的；兜底后整份数据仍有错误，抛 `ingest_bad_reply`。
- `store.ts`：抽取记录 `<书库>/.ingest/<书 id>/`：`source.json`（切好的章）、`commits/<revision>.json`（这次提交的清单：各章最终草稿与整理结果的文件名、章明细）、`drafts/`、`consolidations/`（内容寻址或按 revision 命名，只增不改）、`usage.jsonl`（每次 HTTP 尝试一行，只追加）、`state.json`（只放瞬时信息：由谁运行、当前章与步骤、等待中的重试、停下的原因）。
- `job.ts`：`runIngest(...)`（在 worker 里）：读 `book.json` 的 `extraction` 得到已提交的章与清单 → 从下一章起逐章抽 → 第 5 的倍数与原文末章先做整理 → 提交 → 循环。每次模型请求前、重试等待中、提交前检查停止标志。
- `runner.ts`（主线程）：拿锁 → 起 worker → 转发进度 → 停止时置标志、发消息、等 worker 退出（宽限 15 秒，超时结束 worker）→ 把 `state.json` 记成停下 → 放锁。worker 的 `error`、`close` 与正常退出都走同一个幂等的收口。
- `start.ts`：在锁里做 `planIngest`：切章并判断 `new`、`resume`、`append`、`done`，或报 `ingest_text_changed`、`book_exists`；“有抽取记录”按 `.ingest/<书 id>/source.json`。`new` 在锁里写好 `source.json` 才算占用 id。
- `status.ts`：权威进度来自 `book.json` 的 `extraction` 与它引用的提交清单（第 1 章提交前为 0 章）；`state.json` 只补瞬时信息；拿得到锁说明没有任务在运行，此时 `state.json` 写着运行中就报“运行它的进程已退出”；进度已到原文末章即 `done`。

要守住的不变量：
- 一章的输入只依赖已提交的数据与本章原文：接着抽、追加的结果与一口气抽完相同（回放测试锁定）。
- 唯一的提交点是书目录里 `book.json` 的改名（第 1 章是整个书目录的改名）。提交顺序：写好草稿、整理结果、提交清单 `commits/<n+1>.json` 与新数据文件 → 改名替换 `book.json`（`extraction: {through, revision, commit}`）。改名前被杀：多写的文件没有被引用，下次拿锁后清掉；改名后被杀：一切以 `book.json` 为准。`book.json` 引用的清单或文件缺失时报错（抽取记录损坏），不跳章。

### packages/nb-story/src/core/library.ts、cursor.ts、book-index.ts（同一代内更新）

- `BookMeta` 加 `revision` 与 `graph`（数据文件名 `graph-<revision>.json`）及可选的 `extraction`。读取时把格式 1 的旧元信息归一为 `revision: 1`、`graph: "graph.json"`，不改写磁盘（计划审查第 15 条）。
- `pinBook` 的协议：读 `book.json` → 打开它指向的数据文件 → 再读一次 `book.json`，一代与版本都没变才算固定住；打开失败（文件已被回收）或版本变了就关掉句柄重来（计划审查第 1 条）。现有的 inode 核对保留。
- `commitExtraction(id, …)`：书不存在时按现有导入流程建目录（临时目录改名，新的一代）；已存在时写新数据文件、改名替换 `book.json`，再回收旧数据文件。回收与 `pinBook` 的重试配合：读到旧版本、还没打开时文件没了，重试即可。
- 书目录的不变量从“从不原地改写”改为“只有 `book.json` 与数据文件按上面的顺序替换”，模块头同步改写。
- 游标、索引缓存的键改为 `(id, generation, revision)`；每次查询照常读 `book.json`，所以别的进程提交后，本进程的新查询拿到新版本。
- `importBook` 加入同一个 id 锁：在锁里检查抽取记录与书目录，再改名占用；抽取的新建与首次提交、删除也都在这把锁里（计划审查第 8 条）。

### 停止与删除

- 命令行：`onProcessInterrupt`（nb-harness 已有）→ `runner.stop()`。
- serve：进程内的 Runner 表加一个“接纳”门禁。服务停止时先同步关闭门禁（之后的 `ingest.start` 得到“服务正在停止”），再停全部已接纳的 Runner（含正在启动的）、等它们放锁，再撤销登记、停监听（计划审查第 7 条）。
- `book.remove`：先停本进程里这个 id 的 Runner；再非阻塞地拿 id 锁，拿不到（别的进程在抽）得到 `ingest_running`；拿到后在持锁期间删书目录与抽取记录，再放锁。锁文件本身不删。

### packages/nb-story/src/qa/config.ts、config-edit.ts、cli/config.ts

- schema 加可选 `ingest.model`（不收 `thinking`）；`ingestModel(config)` 返回它或回落到 `model`（去掉 `thinking`）。
- `config set ingest.model '<JSON>'` 整节写入，`ingest.model.<字段>` 只在整节已存在时可改；`config unset ingest.model`。
- `config test --ingest`：用 `ingest/model.ts` 的同一条路径，按 `minimal`、`medium` 各发一个最小请求，分别报告；不经 nb-harness。

### packages/nb-story/src/cli/ingest.ts（新）、commands.ts

- `nbstory ingest <文件>`、`--preview`、`--book`、`--status`；进度写标准错误，`--json` 只输出一个 JSON；退出码见 ingest.md 输出 15。命令表加 `ingest`（`preview`、`status` 是开关）。

### packages/nb-story/src/server/、src/contract/contract.ts

- 契约加 `ingest.preview`、`ingest.start`、`ingest.stop`、`ingest.status` 的 schema（`content` 是 base64）；`ingest.start` 在 serve 里起 Runner、立即返回。请求体上限对 `ingest.*` 放到 48 MiB；超限走 `ingest_bad_text`。

### packages/nb-story/src/web/

- 书架（输出 36）：有抽取记录的书 id 合并进列表（`books.list` 加 `ingest.status`），运行中每 5 秒刷新。
- 导入页 `/import`（输出 37）、进度页 `/ingest/<书 id>`（输出 38、40），组件照草稿稿子（`.worktree/w00024-t06-drafts` 的 `src/web/drafts/IngestDraft.vue`）改成真实数据。
- 书里的更新（输出 39，计划审查第 13 条）：`BookSession` 加数据版本：`info` 可替换，`refresh()` 换成新版本——取消旧请求并丢弃晚到的旧回包、清空全部游标、保持阅读位置、页面、对象与视角，重取当前显示的各面板（主区与抽屉）。顶栏徽标每 5 秒查一次进度，发现新提交就提示；翻页、换页面、换位置、开对象之前先比对版本，落后就先 `refresh()`；`cursor_invalid` 也触发一次 `refresh()`。
- 新组件的同名 `.md` 与 Lab 登记按 ui-development 的规定。

### 测试数据与脚本

已整理进 worktree（未提交）：
- `tests/fixtures/ingest/run-med-100-final.json.gz`：t34 `run-med-100` 的 100 章最终草稿与 20 批整理结果。
- `tests/fixtures/ingest/replay-ch001-010.json.gz`：前 10 章录下的模型回复（段落块、草稿、核对；第 5、10 章有整理；没有修复）。

还要补：
- 第 100 章录下的回复（服务响应场景：前 99 章用最终草稿直接造成已提交状态，只回放第 100 章，提交时编译 100 章）。
- `testing/replay-endpoint.ts`：OpenAI 兼容的本机端点，按请求正文认出章号与步骤（段落块、草稿、核对或修复、整理各有固定的任务文字；同一章第二次出现核对任务即修复，按章计数），认不出就让测试失败；可注入 503、401、拒绝推理档、坏 JSON、截断、跑飞，记下收到的请求数与推理档。原文从样例书的 `sources` 生成，不另存。
- 验收 2 的追加：先给 5 章（第 5 章是末章，用录下的第 5 章整理），再给 10 章（第 10 章用录下的第 10 章整理），全部是录下的回复。
- 故障与修复路径（验收 5、7 与时间环）用测试里手写的回复，标明是“新合同的语义场景”，不冒充录下的数据。

两类对照分开：
- **编译迁移对照**（固定输入）：100 章最终草稿与整理稿编译，结果与 t34 `dataset-v9.json`（即现在的 `sample-100ch.json.gz`）相同，只在三处改动影响的字段上不同；差别按类统计并抽查（称呼位置与随之变化的称呼出现、回补知情与秘密的 `at`），不逐条硬编码。
- **管线语义回放**：回放前 10 章，最终草稿与 t34 的 `draft.json` 对照，差别逐条列出并说明来自哪一处改动；没有差别的章必须逐字相同。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `packages/nb-story/AGENTS.md` | 抽取模块的位置；管线搬自 w00005 t29、t27 与“提示词文字不改”的约束；抽取的模型调用走 `openai` SDK 而非 nb-harness 的理由 |
| `packages/nb-story/tests/fixtures/README.md` | 两份新测试数据的来源 |

## 切片

1. **S1 搬编译与切章**：`text`、`draft-schema`、`compile`（三处改动）、`context`。验证：编译迁移对照；切章（验收 6）；称呼与回补知情的可见位置（验收 7，编译加查询）；时间环的 `records`。
2. **S2 单章管线**：`draft-tools`、`reconcile`、`prompts`、`model`、`chapter`，回放端点。验证：回放前 10 章对照；重试、跑飞、不成形、拒绝推理档、时间环兜底、用量不完整（验收 5，注入等待，数端点请求与推理档）。末尾用真实 luna 抽 3 章，与 t34 同章的草稿条数、问题数对照。
3. **S3 任务与书库**：`store`、`job`、`runner`、`start`、`status`，`library` 的提交、pin 协议、版本与旧格式归一、id 锁，删除。验证：验收 1 到 4、7、8 的进程内部分；提交各阶段强杀（验收 3）；worker 崩溃后能判停下、能接着抽与删除；queries 与 qa 的现有测试不改断言通过。
4. **S4 命令行与配置**：`nbstory ingest`、`ingest.model`、`config test --ingest`。验证：验收 1、2、4、9 走真实命令行进程；qa 输出 23。
5. **S5 服务与网页**：`ingest.*` 方法、serve 的 Runner 表与停止顺序、网页三处与书里的更新。验证：验收 10（只回放第 100 章、提交时的服务响应与停止）；viewer 验收 9 的 e2e，另覆盖“没点徽标就翻页”“点了更新但参数不变”“旧请求晚到”；关服与 `ingest.start` 同时到达。前端交 Sonnet 审查。
6. **S6 真实模型**：前 3 章 smoke（网页，停一次再继续）；前 20 章三次回归（验收 11，约 6 元加判分约 0.3 元）。

每片自跑 `bun test`（nb-story）、`bun run typecheck`；S3 起跑 queries 与 qa 的全部测试。S2、S3 完成后交 omp 实现审查一次。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| ingest 输出 1 到 3、验收 2、6 | S1、S3、S4 |
| ingest 输出 4、5、9、10、验收 5 | S2 |
| ingest 输出 6、7、11、16、17、验收 1、3、4、8 | S3、S4（进程内与真实命令行） |
| ingest 输出 8、验收 7 | S1 编译加查询；S3 回放 |
| ingest 输出 12、验收 10 | S5 |
| ingest 输出 13 到 15 | S4 命令行；S5 网页 e2e |
| queries 抽取进度（时序与寿命、F3、F10） | S3 |
| qa 时序（一问固定抽取进度）、输出 23、ingest 验收 9 | S3、S4 |
| viewer 输出 36 到 40、验收 9 | S5 |
| ingest 验收 11 | S6 |

## 验证

- 每片：`bun test`、`bun run typecheck`（nb-story），`bun run docs:check`。
- 端到端：真实书库、`nbstory serve`，网页导入样例书前 3 章、真实模型抽完、中途停一次再继续，查看器里打开；命令行同样走一遍，`--status` 与网页显示一致。
- 留下的未验证边界：几百章以上的耗时与费用（只按 100 章外推；编译时间随章数增长，100 章约 10 秒一次）；非 luna 模型的质量；Windows（flock 不支持，serve 已有同样限制）。

## 不做与风险

- 不做：长书费用控制（只带相关记录）；改稿重抽；EPUB、GBK；同一章两份草稿比对；人工修正记录；已导入的 100 章样例书的称呼位置修正（数据文件里已经丢了模型标注的位置，修不回来；重新抽取的书没有这个问题）。
- 风险：换成 `openai` SDK 后请求与 `luna.ts` 直连基本同形（都是 chat completions、流式、`reasoning_effort`、`response_format`），S2 末尾实测对照。
- 风险：编译时间随章数增长，长书每章提交越来越慢（不影响合同，影响速度）；超过几百章再考虑增量编译。
