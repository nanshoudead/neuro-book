# t20 实施计划：抽取管线七点修复

## Context

[t19](../t19-journey-west-example/README.md) 用真实模型抽《西游记》100 回暴露了七个问题。开发者 2026-10-25 全部确认并要求按推荐做；其中两处取舍已定：
- **不跳章**：记忆图顺序累积，跳过一章会让后面的“前文”缺一块。所以第 3 点做成“失败后命令自己重跑几次”，不做“跳过失败章往后抽”。
- **密钥只读进程环境变量**（方案 A）：nb-story 的命令不读任何 `.env`；问答、查看器与抽取判断密钥的口径一致。

依据：[`story.ingest`](../../../../docs/specs/story/ingest.md) 输出 9、10、13、14 与“副作用与数据”；[`story.cli`](../../../../docs/specs/story/cli-skill.md)；[`story.qa`](../../../../docs/specs/story/qa.md#配置)。合同变更：是，改 `story.ingest`、`story.cli`，加 ADR 0032。

## 技术选型

无新依赖。重试沿用 `callModel` 里现有的延迟表机制，只加一张限流的表；落盘沿用 `IngestStore`。

## 关键设计

设计审查（omp，2026-10-25，[报告](evidences/design-review.txt)）9 条全部成立，下面是修订后的设计；第二、三、四节与第六节的做法相对初稿有较大变化，原因写在各节。

### 一、`ingest/model.ts`：限流退避与用量（第 4、5 点）

- `retryable` 改为 `network` 或 `rate_limit`，限流用单独的延迟表 `RATE_LIMIT_DELAYS_MS`：1、2、5、10、15、20 分钟，之后每次 30 分钟，至多 12 次 HTTP 尝试，纯等待合计 203 分钟（审查第 3 点风险条的数字；不是“约 5 小时”）。`maxAttempts` 仍压住两张表（`config test --ingest` 只试一次）。
- `Retry-After`：在 `classify` 里从 `APIError.headers`（标准 `Headers`）取 `retry-after`，只认有限、非负的秒数，上限 30 分钟，作为 `ModelError.retryAfterMs` 带出；空串、负数、NaN、日期格式一律走表。
- 用量：只有“服务明确拒绝、没有受理”的失败记完整的 0——401、403 与 429；5xx、408、网关故障、流中途断开、跑飞、超时、中止仍标不完整（审查第 3 点：HTTP 状态码不能证明上游没有计费）。分类在持有原始错误与流阶段的 `attemptOnce` 里做，不看错误文字。
- 延迟表可由调用方覆盖：`CallOptions.delaysMs?: {network?: number[]; rateLimit?: number[]}`，只给测试与 `StartInput.timing` 用（审查第 9 点：真进程测试要能把分钟级等待缩成毫秒；它是普通参数，不是环境变量）。

### 二、`ingest/chapter.ts`、`ingest/store.ts`：坏回复留存（第 2 点）

- 每次一步的回复两次都不成形（`asker` 里 `round === 2`）时，不论后面是整章失败（beats、draft）还是容错继续（recall 退回规则、consolidation 跳过），都把两次回复的原文、结束原因与判断结果写到 `.ingest/<书>/bad-replies/<章>-<步骤>.json`，同章同步骤再次失败覆盖。经 `ChapterRun.onBadReply` 回调交给 `IngestStore`，chapter 不依赖存储。
- 写法：同目录写临时文件再改名，强杀时留下的要么是旧的完整文件，要么是新的完整文件。保存失败（只读目录、磁盘满）只在 activity 里记一条诊断与标准错误一行，不让抽取失败，也不在错误信息里写不存在的路径；保存成功才在 `IngestBadReply` 与问题清单的信息里写相对路径。
- 清理（审查第 5、6 点，改了初稿的“章提交后删除”）：不与章提交挂钩。保留最近写下的 20 个文件，写新文件时顺带删最旧的多余文件；`ingest_bad_reply` 与容错退回的诊断一样留着。书被删时整个 `.ingest/<id>` 一起删。这样没有“提交成功后崩溃就漏清理”的窗口，也没有“同一轮就删掉仍未解决的证据”。
- 回复里有小说原文：`IngestStatus`、`--json`、网页不带它，只带路径；验收用可辨认的小说片段断言不出现在状态与输出里。

### 三、章内自动重做（第 3 点；审查第 2、8 点后重做）

初稿是 CLI 外层循环：每轮放锁、等待、再 `startIngest`，会有“等待期间别的进程删书再同 id 新建、旧命令又把它写回来”的窗口，多轮的用量、状态与 JSON 输出也要另外拼。改成**任务内部**重做，不放锁、不换 run：

- `job.ts` 的逐章循环里，一章因 `IngestBadReply` 或渠道失败（`ModelError` 的 `kind` 为 `network`）失败时，不退出任务：写一条 `retry` 事件（`status` 已有 `retry.attempt/waitMs/until` 的显示，复用），在同一个中止信号上可被打断地等一会儿，再从头重做这一章（这一章没提交，书的数据不变）；同一章重做次数用完才按原来的方式停下。等待与重做都在持有 id 锁、同一个 run 里，用量与时间自然累计到“这次任务”，一次命令仍只有一份小结与一份 `--json`，Ctrl-C 与 `ingest.stop` 照旧立刻生效，删书仍由现有机制停任务。
- 次数与间隔：缺省重做 3 次，等 5、10、15 分钟；CLI 选项 `--auto-resume <次数>`（0 关闭），网页的独立服务沿用缺省（不另加界面）。次数按同一章算，下一章有新的额度，所以“一回出错就停掉整本”变成“同一章连续失败 4 次才停”。限流（`rate_limit`）不在这里重做：`callModel` 内部已经退避 203 分钟，再叠一层只会让最坏情形翻几倍；认证、额度、本机错误、`provider` 不重做。
- 最坏时间（审查风险第 3 条的数字）：同一章在网络类失败上，每轮最多 6 次 HTTP 尝试（等 30+60+120+180+300 秒共 11.5 分钟）加章级等待，4 轮合计约 41.5 + 30 = 71.5 分钟，不含请求本身耗时；限流单次请求最长 203 分钟。写进 Spec。
- 测试：`StartInput.timing.chapterWaitsMs` 与第一节的 `delaysMs` 一起经 `WorkerStart` 传到 job；同进程的 `runIngest` 测边界，真 CLI 与 Worker 用毫秒级等待测“失败后重做并成功”“次数用完停下”“等待中 Ctrl-C”“重做期间别的进程删书、重建同 id”。

### 四、密钥口径（第 1 点；审查第 1、4 点后改了方案）

实测（审查者与我之前 t19 的发现一致）：除了 OMP 导入时读 `.env`，Bun 自己也会在任何用户代码之前加载当前目录的 `.env`，调整导入顺序挡不住，所以初稿的“`cli.ts` 第一个导入快照”只能挡 OMP，不能做到“不读任何 `.env`”。**这条偏离开发者确认的“方案 A”字面（不读 .env），改为“以启动环境为准”**，记入待确认清单：

- **口径**：nb-story 认的密钥来源是进程启动时的环境（shell `export`，加上 Bun 自己对当前目录 `.env` 的加载，这是 Bun 的行为、文档里照实写出）；OMP 导入时额外读入家目录与 OMP 配置目录里的 `.env` 不算。同一把钥匙在 `config show`、`config test`、`ingest`、`ask`、`serve` 与网页配置页里得到同一个“已设置/没设置”。
- `platform/process-env.ts`：`cli/main.ts` 的第一个依赖，拷一份启动环境，对外 `startupKey(name)`。`config show`、`config test`、`ingest` 与 Worker 的发起参数（主线程取值、显式传给 Worker，不依赖线程继承环境，审查实测线程并不继承 OMP 注入）都用它。
- 问答：自定义服务商的模型，`modelOf` 返回的 `ResolvedModel.apiKey` 换成读快照的函数，缺则 `qa_unconfigured`，信息写明变量名与“只认启动时的环境变量”；目录里的模型，`apiKey` 外面包一层门：快照里没有目录登记的任何一个变量就按缺密钥处理，有就交给 OMP 取值。**已知限制**：目录模型的取值仍由 OMP 决定，家目录 `.env` 里更高优先级的变量（例如 `ANTHROPIC_OAUTH_TOKEN`）可能被它选中，只在 Spec 与 README 里写明，不去改 nb-harness；网页的 `config.get/set`、`models.catalog/discover`、`config.test` 同样走这套判断。
- 新增 ADR 0032 记这个决定、Bun 与 OMP 两层加载的实测与限制；README 与 `config init` 提示补一句“密钥用环境变量，nbstory 不读家目录的 .env”。

### 五、价格提示（第 6 点）

- 没配 `price` 时：`nbstory ingest` 开始时在标准错误写一行“没有配置价格，只报 token 数；用 `config set ingest.model.price '{…}'` 补”；`config show` 的抽取一节同样提示。开着挑相关说法、用了单独模型时，按它自己的单价状态提示。不内置价目表。

### 六、人物合并（第 7 点；审查第 7 点后补全调查）

调查结果（只读，见 Task 记录）：整理阶段的 5 次合并都不涉及唐僧。他被显示成“法明长老”有两个原因：模型把“法明和尚为他剃发”这类事件说法标成 `identity`（`s9-16`），以及 `representative` 取编号靠前的 person。同类误标还有 `s9-38`、`s70-2`（连到“取经”任务）、`s72-5`。修复分三层：

1. **编译校验**（`ingest/compile.ts`，离线可验证）：`identity` 说法的两个对象类别不可能是同一个个体（任一方是 `task`）时记为错误、丢弃这条说法；用 t19 的 `extraction-100.json` 离线重编译，核对 `s9-38`、`s70-2` 被丢、合理的 person/persona、person/真身连接保留。
2. **显示名**（`core/identity.ts` 的 `representative`，离线可验证）：取出现最多的 person 成员，并列时取编号小的，不再取编号最靠前的。
3. **提示词**：“`identity` 只写‘甲就是乙’（同一个个体换了名字、身份或显露真身）；给人取名、师徒、捆绑、猜测等写 `event`、`social`、`kinship`、`attitude`；原文没有明确说就是同一个个体时标不确定”。这一条改抽取发给模型的文字，要真实模型验证（Spec 验收 11 与对西游记第 9、12 回的重抽对照），实施到这一步停下向开发者要批准。已入库的示例图不改。

## Spec 与文档改动

- `docs/specs/story/ingest.md`：输出 9（限流的退避表、`Retry-After`、最坏等待数字）、输出 10（回复不成形：章内重做 3 次与间隔、坏回复留存与数量上限）、输出 13（只有明确拒绝才算完整的 0）、输出 14 与退出码（`--auto-resume`、价格提示）、“抽取模型”（价格提示）、“副作用与数据”（`bad-replies`）、F4/F5 的“调用方怎么办”、输出 5 的校验（task 类别的 identity 说法）、验收 5 增限流与坏回复留存场景。
- `docs/specs/story/cli-skill.md` 与 `qa.md` 配置一节：密钥口径与已知限制。
- `docs/adr/0032-nb-story-keys-from-startup-env.md`；两个 README 与 `config init` 提示。

## 切片

1. 限流与用量（一）：`model.ts`、`CallOptions.delaysMs`、回放端点支持返回头，测试；Spec 输出 9、13。
2. 坏回复留存（二）：`chapter.ts`、`store.ts`、`job.ts` 接线，测试走真目录与 runner；Spec 输出 10 与数据。
3. 章内自动重做（三）与价格提示（五）：`job.ts`、`runner.ts`、`worker.ts`、`cli/ingest.ts`，测试走真进程；Spec 输出 10、14、退出码。
4. 密钥口径（四）：`process-env.ts`、`config`、问答模型适配、网页配置、Worker 传值，测试断言真正发出的认证头；Spec、ADR 0032、README。
5. 人物合并（六的 1、2）：编译校验与显示名，用 t19 的 `extraction-100.json` 离线重编译验证；第 3 层提示词停下等开发者批准。

收口：`bun run test:affected`（nb-story）、nb-story 的 typecheck、`docs:check`。

## 验收映射

两层：同进程注入延迟表验证边界；真 CLI、Worker 与回放端点（毫秒级等待经 `StartInput.timing`）验证跨线程停止、书锁、stdout 与退出码。

- 限流：回放端点回 429（带与不带 `Retry-After`、值为空、负数、日期）后成功或用完；401、429 的请求用量完整，5xx、流中途断开不完整（`model.test.ts`、`runner.test.ts`）。
- 坏回复：recall、consolidation 两次不成形（容错继续）与 beats、draft 两次不成形（章失败）都落盘，内容正确、覆盖、保留上限 20、只读目录保存失败不让抽取失败且不写路径；状态与输出里没有小说片段；强杀后文件完整（`runner.test.ts`、`cli/ingest.test.ts`）。
- 章内重做：第 1 章第一次不成形、重做成功，一份小结、用量累计、仍是同一 run；同一章 4 次失败后以 `ingest_bad_reply` 停下，退出码 4；下一章有新额度；等待中 Ctrl-C 退出 130；重做等待中另一个进程删书、同 id 新建，旧任务不再写；认证失败不重做；`--auto-resume 0` 关闭。
- 密钥：变量只在 OMP 读的家目录 `.env` 时，`config show`、`ingest`、`ask`、网页配置报同样的“没有设置”；`export` 后都认；Bun 加载的当前目录 `.env` 算启动环境（文档照实写）；端点收到的认证头是预期的（假密钥）。
- 人物：离线重编译 t19 的数据，`s9-38`、`s70-2` 被丢，person/persona 连接不变；`find 唐僧` 的显示名是“玄奘”相关的人物，不是法明。
- 验收 11（真实模型回归）与西游记第 9、12 回重抽对照：只在第六点第 3 层改了提示词时，需开发者批准。

## 验证

端到端：真 `nbstory ingest` 进程加回放端点的限流、坏回复、章内重做三条路径。未验证：真实渠道 429 的 `Retry-After` 形式（t19 的 429 没带）；目录模型在家目录 `.env` 存在更高优先级变量时的取值（OMP 决定，只写进文档）；网页独立服务的停止 5 秒合同在退避等待期间的表现（机制上等待可被中止信号打断，不另测浏览器）。

## 不做与风险

- 不做跳章；不内置价目表；不改 nb-harness；不为网页端另加重做次数的界面。
- 风险：限流单次最长等 203 分钟，期间任务看起来“卡住”，靠 `status` 里的重试倒计时说明；章内重做 4 轮最多再等约 30 分钟。
