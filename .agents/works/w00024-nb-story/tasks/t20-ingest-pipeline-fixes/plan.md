# t20 实施计划：抽取管线七点修复

## Context

[t19](../t19-journey-west-example/README.md) 用真实模型抽《西游记》100 回暴露了七个问题。开发者 2026-10-25 全部确认并要求按推荐做；其中两处取舍已定：
- **不跳章**：记忆图顺序累积，跳过一章会让后面的“前文”缺一块。所以第 3 点做成“失败后命令自己重跑几次”，不做“跳过失败章往后抽”。
- **密钥只读进程环境变量**（方案 A）：nb-story 的命令不读任何 `.env`；问答、查看器与抽取判断密钥的口径一致。

依据：[`story.ingest`](../../../../docs/specs/story/ingest.md) 输出 9、10、13、14 与“副作用与数据”；[`story.cli`](../../../../docs/specs/story/cli-skill.md)；[`story.qa`](../../../../docs/specs/story/qa.md#配置)。合同变更：是，改 `story.ingest`、`story.cli`，加 ADR 0032。

## 技术选型

无新依赖。重试沿用 `callModel` 里现有的延迟表机制，只加一张限流的表；落盘沿用 `IngestStore`。

## 关键设计

### 一、`ingest/model.ts`：限流退避与用量（第 4、5 点）

- `retryable` 改为 `network` 或 `rate_limit`。限流单独一张延迟表 `RATE_LIMIT_DELAYS_MS`：1、2、5、10、15、20 分钟，之后每次 30 分钟，至多 12 次 HTTP 尝试（约 5 小时）。服务给了 `Retry-After`（秒数）时取它，上限 30 分钟。`maxAttempts` 仍可压低（`config test --ingest` 只试一次）。
- 有 HTTP 状态码的失败（服务在发回任何内容前就拒绝了：429、5xx、401 等）没有产生用量，记 `usage.complete = true`、全 0；只有流中途断开、跑飞、超时、中止这类“可能已经计费但拿不到数”的才保持不完整。理由：t19 里每个 429 都把全书的汇总标成“不完整”，其实什么都没花。
- 不变量：一次 HTTP 尝试先记“开始”后结算（`onAttemptStart`）不变。

### 二、`ingest/chapter.ts`、`ingest/store.ts`：坏回复留存（第 2 点）

- 回复不成形时（`asker` 里 `round === 2` 抛 `IngestBadReply` 之前），把两次回复的原文、结束原因、判断结果写进 `.ingest/<书>/bad-replies/<章>-<步骤>.json`（`{chapter, step, why, replies: [{round, finishReason, text}]}`，同章同步骤再次失败覆盖）。经 `ChapterRun.onBadReply` 回调交给 `IngestStore`，不让 chapter 依赖存储。
- 错误信息末尾写这个文件的相对路径；这一章提交后删除它名下的坏回复文件，目录不会越攒越大。
- 回复里可能有小说原文，与抽取记录同属书库内部数据，随删书一起删；原始请求仍不保存。

### 三、`cli/ingest.ts`：失败后自动重跑（第 3 点）

- 新选项 `--auto-resume <次数>`（缺省 3，0 关闭）。任务以 `ingest_bad_reply` 或 `model_failed`（`kind` 为 `network`、`rate_limit`、`provider`）停下时，命令等一会儿再接着抽同一本；认证、额度、本机错误、`ingest_text_changed` 等不重跑。
- “次数”按同一章连续失败算：这一轮提交了新章就清零。等待 5 分钟 × 第几次，至多 15 分钟。仍失败时与现在一样以失败码退出（退出码 4）。
- 进度仍逐条写标准错误，重跑前写一行“第 n 次自动重跑，等 x 分钟”；被 Ctrl-C 打断照常 130。网页的独立服务不自动重跑（任务停下后由用户在页面里再开始），范围外。

### 四、密钥只读进程环境变量（第 1 点）

- 新增 `platform/process-env.ts`，由 `cli.ts` 第一个导入，在任何 OMP 模块之前把 `process.env` 拷一份快照；对外 `startupEnv()`。`config show`、`config test`、抽取（含 Worker 的发起参数）、问答与查看器判断“密钥是否已设置”都读快照。
- 问答、查看器发请求前，若密钥只在 OMP 注入后的 `process.env` 里有、快照里没有，按 `qa_unconfigured` 失败，信息写明“nbstory 只读进程环境变量，不读 `.env`；请 `export <变量名>`”。Worker 里的 `withKey` 由主线程传入密钥值而不是在线程里再读环境（线程的 `process.env` 是主线程环境的拷贝，同样含 OMP 注入）。
- 不改 OMP：它在导入时读 `.env` 是它自己的行为，我们只保证 nb-story 自己的判断不受它影响。
- 新增 ADR 0032 记这个决定与代价（用户要自己 `export`；README 与 `config init` 的结尾写明）。

### 五、价格提示（第 6 点）

- 没配 `price` 时：`nbstory ingest` 开始时在标准错误写一行“没有配置价格，只报 token 数；用 `config set ingest.model.price '{…}'` 补”；`config show` 的抽取一节同样提示。不内置价目表（价目会过期）。
- 日志里“费用未知”的写法保留，但带上 token 数（已经有）。

### 六、人物合并（第 7 点）

- 先只读调查，不调用模型：读 t19 的 `extraction-100.json` 里 5 条 `merges`、`consolidations` 与“法明长老”这个对象的来源（`mergedFrom`、称呼、`label`），查清是哪个步骤把“唐僧”并进去、显示名从哪来。
- 查清后改规则或提示词；修改影响抽取发给模型的文字时，需要真实模型验证（Spec 验收 11），那一步要开发者批准，到时停下汇报。若原因是“同一人物确有多个正当称呼、只是显示名选得不佳”，只改显示名规则，用现有数据离线重编译验证，不用真实模型。

## Spec 与文档改动

- `docs/specs/story/ingest.md`：输出 9（限流的退避表与 `Retry-After`）、输出 10（坏回复留存与路径）、输出 13（HTTP 拒绝的请求不算不完整）、输出 14 与退出码（`--auto-resume`）、“副作用与数据”（`bad-replies`）、“抽取模型”（价格提示）、F4/F5 的“调用方怎么办”、验收 5 增限流与回复留存场景。
- `docs/specs/story/cli-skill.md`：`config show`、`ask`、`serve` 的密钥口径。
- `docs/adr/0032-nb-story-reads-keys-from-process-env.md`；README 与 `config init` 提示补一句。

## 切片

1. 限流与用量（一）：model.ts 与测试，Spec 输出 9、13。`bun test packages/nb-story/src/ingest/model.test.ts`。
2. 坏回复留存（二）。chapter.ts、store.ts、测试，Spec 输出 10 与数据。
3. 自动重跑（三）与价格提示（五）。cli 与测试，Spec 输出 14、退出码。
4. 密钥口径（四）。process-env、config、ask/serve、worker、测试，Spec、ADR 0032、README。
5. 人物合并调查（六），写入 Task 记录；能离线修的修，需要真实模型的停下汇报。

收口：`bun run test:affected`（nb-story）、`bun run typecheck`（nb-story 相关）、`docs:check`。

## 验收映射

- 限流重试：`model.test.ts` 用本机端点回 429（含和不含 `Retry-After`）、注入时钟，共 N 次后成功或停下；HTTP 拒绝的请求用量完整、流中途断的不完整。
- 坏回复：`chapter.test.ts` 回放两次非 JSON，验证文件内容、错误信息里的路径、该章提交后文件被删。
- 自动重跑：`cli/ingest.test.ts` 回放“第 1 章 bad_reply，重跑后成功”“连续失败用完次数以退出码 4 结束”“认证失败不重跑”“Ctrl-C 不重跑”。
- 密钥口径：`config` 与 `ingest` 在“变量只在 `.env`”时报同样的“没有设置”；`process-env` 的快照在导入 OMP 之前取得。
- 验收 11（真实模型回归）：只在第六点改了提示词时才跑，需要开发者批准。

## 验证

端到端：用回放端点跑 `nbstory ingest` 的限流、坏回复两条路径。未验证：真实渠道下 429 的 `Retry-After` 形式（t19 的 429 没带这个头，不确定）；网页独立服务路径不自动重跑。

## 不做与风险

- 不做跳章；不做网页端自动重跑；不内置价目表。
- 风险：`Retry-After` 的格式多样（秒数或日期），只认秒数，其余走表；快照要保证先于 OMP 导入，用测试守住导入顺序。
