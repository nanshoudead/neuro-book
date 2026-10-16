# t05 实施计划：内置问答与 `nbstory ask`

## Context

nb-story 第一版只给外部 Agent 用 Skill 问答。开发者 2026-10-15 改定做内置问答，引擎建在 nb-harness 上（[t05 README](README.md) 决定 1 到 3）；nb-harness 的加强（Profile 选工具、收尾工具、`turn()` 的结果）已在 [w00002 t21](../../../w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/README.md) 完成并合入。

- 合同：[`story/qa.md`](../../../../../docs/specs/story/qa.md)（新，`planned`）；连带改 [`story/queries.md`](../../../../../docs/specs/story/queries.md) 输出 15 与“副作用与数据”、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md) 的命令表、退出码与边界。引擎依赖 [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)。
- 开发者已定：一问一个 Agent 从头答到尾（决定 13），工具由 Profile 选（决定 9、14），不设步数上限（决定 10），Spec 要点与四点（决定 16 到 20：章数上限 20、出处必须读过、全读只记录、`nbstory qa` 现在做），回归门槛 19.6% 与 11/48。
- 工作方式：代码在 worktree `.worktree/w00024-t05-qa`（分支 `feat/w00024-t05-qa`）；主会话写代码；后端审查交 omp。

## 关键设计

### `packages/nb-story/src/core/queries/search.ts`：按词拆开、按命中排序

- `terms(query)`：按空白与中英文标点（`\s` 与 `\p{P}`）拆开，去空、去重。拆不出词的查询（空串、只有标点）沿用现在的行为，不在这次改。
- 每条候选算命中的不同词数 `hits`，`hits > 0` 才收；各类内按 `hits` 降序，再按原来的先后（对象按首次出现、说法按数组顺序、原文按章段）。用 `toSorted` 的稳定排序保住原来的先后。
- `snippet` 截在第一个命中的词周围；`matches`（`context.ts`）不改，逐词调用。
- 只有一个词时结果与改动前逐字相同：`search.test.ts` 现有用例不改就要通过，这是行为不变的证据。

### `packages/nb-story/src/core/api.ts`：固定一代的书会话

问答要求一问固定在开始时的一代上（qa 的“时序与寿命”），而 `api.call` 每次调用都重新解析书。新增：

```ts
interface StoryApi {
    // 已有 library、call
    /** 固定这本书当前的一代；之后的调用都在这一代上，删除与重新导入不影响它。 */
    openBook(book: string | undefined): Promise<BookSession>;
}
interface BookSession {
    readonly id: string;
    readonly generation: string;
    readonly meta: BookMeta;
    call<M extends StoryMethod>(method: M, params: unknown): Promise<StoryOutcome<M>>; // 只接受书级方法；params 里的 book 被忽略
}
```

- 把 `bookCall` 拆成“取索引”与“在给定索引上查询”两段；`call` 用 `openBookIndex` 每次取，`BookSession.call` 用 `openBook` 时取到的那份。参数与结果的 schema 校验共用同一段（`problems`），结果因此与 `api.call` 逐字段相同。
- `openBookIndex` 返回的索引已经是整份读进内存的（见 `book-index.ts` 的缓存），所以会话不持有文件句柄，不需要 `release`。

### `packages/nb-story/src/core/qa-records.ts`：问答记录

只用 `node:fs`，放在 core，以后的独立服务（网页问答页）直接读。

```ts
type QaStatus = "answered" | "failed" | "interrupted";
interface QaRecord {
    id: string; book: string; generation: string; question: string; at: Position; mode: "graph" | "full";
    status: QaStatus; answer: Answer | null; error: {code: string; kind?: ErrorKind; message: string} | null;
    chaptersRead: number[]; usage: Usage; ms: number; model: string; startedAt: string;
}
class QaRecords {
    constructor(library: Library, bookId: string);
    sessionLogPath(recordId: string): Promise<string>; // 确保 qa/ 存在：只 mkdir qa，不递归；书目录不在时报 book_not_found
    write(record: QaRecord): Promise<void>;            // 临时文件 + rename
    list(generation: string): Promise<QaRecord[]>;     // 只列这一代，startedAt 降序
    get(id: string, generation: string): Promise<QaRecord>; // 不在或别的代 → qa_record_not_found
    remove(id: string, generation: string): Promise<void>;  // 记录与会话日志一起删
}
```

- `Library` 加 `bookDir(id)`（现在各方法各自 `join`，收成一处）。
- 记录 id：`<UTC 时间戳>-<6 位随机>`，按名字排序即按时间排序；只允许 `[0-9a-z-]`，`get`、`remove` 先校验 id 再拼路径，防止路径穿越。
- `StoryErrorCode` 加 `qa_record_not_found`（F5，HTTP 404，供以后的服务用）。

### `packages/nb-story/src/qa/`：问答引擎（新目录）

不在 `core/`：它依赖 nb-harness（OMP，只跑在 Bun 上）。`core/` 不依赖它。

- **`config.ts`**：`loadQaConfig(path?)` 用 TypeBox 校验 qa 的 `QaConfig`；文件不在或缺必填字段抛 `QaError("qa_unconfigured")`。`toModel(config)` 调 nb-harness 的 `defineModel({provider: "nbstory", api: "openai-completions", baseUrl, id, apiKeyEnv, contextWindow, maxTokens, price, reasoning: thinking !== undefined})`；`thinking` 交给 `createHarness` 的 `thinkingLevel`。默认路径按 `XDG_CONFIG_HOME`，写法照 `Library` 的 `defaultLibraryRoot`。
- **`read-ledger.ts`**：一问的读原文账本。`clip(range, at)` 把请求范围裁到 P 以前；`admit(chapters, maxChapters | null)` 判断是否超出新章上限；`record(paragraphs)` 记下读过的段；`covers(ref)` 判断出处的每一段都读过；`chapters()` 给读过的章。全读时以“全部读过”构造。
- **`tools.ts`**：`registerStoryTools(registry, sessions)`，经 nb-harness 的 `registerPlugin` 一次登记全部工具（提供方 `nb-story`）。
  - 每个查询工具的声明：id `story.<命令名>`、名字即命令名、说明取命令表的 `summary`，参数 schema 从 `STORY_METHODS[method].input` 去掉 `book`、`at` 得出（TypeBox `Omit`），位置参数与命令同名；命令表与工具共用 `src/cli/commands.ts` 的 `COMMANDS`，不另抄一份。
  - `execute` 按 `ctx.sessionId` 取一问的状态 `{book: BookSession, at, ledger, mode, maxChapters}`，调 `book.call(method, {...params, at})`，结果用 `src/cli/format.ts` 的 `formatResult` 排成文字；查询失败返回 `isError` 结果（码、说明、候选）。
  - `read`：先 `clip`，范围整个在 P 之后是工具错误；图当目录时 `admit` 不过是工具错误（写明上限与已读的章）；通过后调 `source.read`，只把返回的段落记进账本。
  - `answer`：`finish: true`；`execute` 依次做 qa 输出 8 的五项校验，全部问题拼成一条工具错误返回（`isError`，nb-harness 因此不收尾，模型可以再交）；通过时返回“已交卷”。
  - `releaseSession(sessionId)` 删除这一问的状态。
- **`rules.ts`**：作答规则文字。把 w00005 t20 `system.ts` 的 `ANSWER_RULES_V4` 套上 `ANSWER_RULES_V5` 的替换后的定稿抄成一个常量（不再依赖评测代码），后接三条新增（qa 输出 9）。去掉评测里“工作目录”“文件”的说法，改成工具名。
- **`story-qa.profile.tsx`**：`defineProfile`，manifest `{key: "story-qa", version: "1"}`；`initialSchema` 为 `{title, at: string, mode, maxChapters: number | null}`；`tools` 列出全部 `story.*` 查询工具与 `story.answer`（都是必需的）；`context` 渲染系统提示词（身份、阅读位置、做法说明、工具用法、规则）与 `HistorySet`。全读的原文不进 `initial`（否则会话快照里存一整份原文），放在第一条用户消息里。
- **`engine.ts`**：

  ```ts
  function askQuestion(input: {
      api: StoryApi; book?: string; at?: PositionInput; mode: "graph" | "full"; question: string;
      config: QaConfig; signal?: AbortSignal; onProgress?: (event: QaProgress) => void;
      streamFn?: StreamFn; // 透传给 createHarness（它的公开选项），测试用脚本化模型
  }): Promise<QaOutcome>;
  ```

  顺序：读配置得模型 → `api.openBook` 固定一代 → 用 `book.info` 落定 P（查询类失败在这里报出）→ 全读时读出 P 以前原文、超上限报 `full_read_unavailable` → 建记录 id 与会话日志 → 建登记表、登记工具、`createHarness` → `turn(问题)`；以 `stop` 或 `length` 结束且没交卷时发固定提醒，至多两次 → 收集结果 → `finally` 关闭 harness、写记录。
  - 进度：订阅 harness 事件，工具开始时按工具名与参数给一条人话（“查人物卡：苏天晴”“读 37.1—37.96”），`answer` 的错误结果给“作答被退回”与原因。
  - 用量：各次 `turn` 的 `usage` 逐项相加，费用任一次为 `null` 则为 `null`，`complete` 取与。
  - 取消：`signal` 中止时把它交给当前 `turn`，结果 `aborted` 记为“中断”。
  - 写记录失败（书已删除）不改变返回的答案，结果带 `recordSaved: false`。
- **`format.ts`**：答案给人读的格式（`ask` 与 `qa <id>` 共用），出处一律“章.段”。

### `packages/nb-story/src/cli/`：`ask` 与 `qa`

- `commands.ts`：命令表加 `ask`（位置参数问题；选项 `mode`、`config`、`book`、`at`）与 `qa`（可选位置参数 id，或 `rm <id>`），`method: null`，像 `serve` 一样在 `main.ts` 单独分派。`qa` 的可选位置参数要放宽 `decodeArguments` 的个数检查（加 `optional` 标记）。
- `main.ts`：`ask` 才动态导入 `src/qa/`（同 `serve` 只在需要时加载服务端代码），其余命令不加载 OMP。`process.on("SIGINT")` 中止 `AbortController`，等记录写完后以 130 退出；`QaError` 与 `model_failed` 退出码 4。
- 用法文字加两条命令。

### 包与边界

- `packages/nb-story/package.json` 加 `@notnotype/nb-harness`、`@notnotype/nb-profile`、`@notnotype/nb-session` 依赖；`tsconfig.json` 让 `.profile.tsx` 用 nb-profile 的 JSX（文件头 `@jsxImportSource`，同 nb-profile 的 fixture）。
- `packages/nb-story/AGENTS.md` 的“边界”与 [`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md) 的剧情图谱一行：加上依赖 nb-harness、nb-profile、nb-session，只在 `src/qa/` 里用。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/qa.md` | 新建（本次已写） |
| `docs/specs/story/queries.md` | 非目标指向 qa；输出 15 拆词与排序；问答记录写在 `qa/`（本次已改） |
| `docs/specs/story/cli-skill.md` | 非目标、命令表、退出码、边界（本次已改） |
| `docs/specs/README.md` | 待实现表加一行（本次已改） |
| `packages/nb-story/AGENTS.md`、`docs/modules/monorepo-boundaries.md` | 依赖边界（S4） |

Skill 不改（决定：Skill 不变）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | `search` 拆词与排序 | `bun test src/core/queries/search.test.ts` |
| S2 | `openBook`、`Library.bookDir`、`qa-records.ts` | `bun test src/core` |
| S3 | `src/qa/`：配置、账本、工具、规则、Profile、引擎、格式 + 引擎测试 | `bun test src/qa`；`bun run typecheck` |
| S4 | 命令行 `ask`、`qa` + 进程测试；包依赖与边界文档 | `bun run test`；`bun run typecheck` |
| S5 | 真实模型 Smoke 与回归，报告进 Task 证据 | 见“验证” |

每片一次提交；S1 到 S4 完成后做实现审查（omp），再跑 S5。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| queries 输出 15 | `search.test.ts`：原有用例不变；新增多词命中与排序、标点拆词 |
| qa 输出 1、2、3 | `src/qa/engine.test.ts`：脚本化模型调各查询工具，结果与 `formatResult(book.call(...))` 相同；参数里带 `at` 被 schema 拒绝 |
| qa 输出 4、验收 1 | `engine.test.ts`「防剧透」 |
| qa 输出 5、验收 2 | `engine.test.ts`「章数上限」 |
| qa 输出 6、验收 5 | `engine.test.ts`「全读」：上限过小时脚本化模型一次都没被请求 |
| qa 输出 7、8、验收 3 | `engine.test.ts`「退回后交卷」，另逐项覆盖五条校验 |
| qa 输出 9 | `engine.test.ts`：渲染出的系统提示词含 v5 规则与三条新增（断言关键句） |
| qa 输出 10、验收 4 | `engine.test.ts`「提醒」 |
| qa 输出 11 | `engine.test.ts`：两次 `turn` 的用量相加，单价缺省时费用为空 |
| qa 输出 12、14 | `src/cli/ask.test.ts`（真实 `nbstory` 进程 + 本机 OpenAI 兼容端点，写法照 nb-harness `tests/provider.test.ts`）：标准输出与标准错误分开、`--json` 形状、退出码 4 |
| qa 输出 13、验收 6 | `ask.test.ts`「取消」：端点挂起请求时发 SIGINT |
| qa 输出 15、16、验收 7 | `src/core/qa-records.test.ts`（写、列、一代过滤、删除、id 校验）；`ask.test.ts` 跑 `qa` 与 `qa rm` |
| qa 输出 17、验收 8 | `ask.test.ts`「密钥」：端点收到假密钥，记录、会话日志、两个输出里搜不到 |
| qa 时序：运行中删除书 | `engine.test.ts`：脚本化模型的一步里删除再重新导入，答案照常、`recordSaved` 与列表符合 Spec |
| qa F1 到 F5 | F1 `config.test.ts`；F2 `ask.test.ts`（端点回 401，以及不设密钥环境变量）；F3、F4 `engine.test.ts`；F5 `qa-records.test.ts` |
| qa 验收 9、Smoke | S5 |

## 验证

- S1 到 S4：`bun run --cwd packages/nb-story typecheck`、`bun run --cwd packages/nb-story test`；`bun run docs:check`。
- S5 Smoke：本机配置指向 luna 渠道（`baseUrl` 取 `JIJI_LUNA_BASE_URL`，`id` 为 `gpt-6-luna`，`apiKeyEnv: JIJI_LUNA_API_KEY`，`maxTokens` 16000，`thinking` 不写，与 w00005 t34 作答一致），在样例书上 `nbstory ask` 一问，再 `nbstory qa` 列出与显示。
- S5 回归：Task 目录 `scripts/qa-eval.sh`，照 t03 的 `skill-eval.sh`：每题以 `nbstory ask --json --at <requiredPrefix>` 作答，答案按 `format.ts` 排成文字写成 t22 判分器的输入，判分照 `skill-eval-grade.sh`（一审跑两遍补渠道失败），确定性检查与计数照 `skill-eval-check.ts`。份数：56 × 3 + 16 × 3 = 216 份图当目录，加 16 份全读。答案与判分进 `evidences/qa-eval/`，会话日志留本地 `.local/agent/works/w00024-nb-story/tasks/t05-qa/`。
- 未验证的边界：不同模型的答对率（门槛只对 gpt-6-luna 成立）；Windows（`flock` 之外，问答本身不依赖平台，但没测）。

## 不做与风险

- 不做网页问答页、并发上限与排队（属于独立服务，后续 Task）。
- **风险：回归不达标。** 工具从 shell 换成查询接口、且一个 Agent 从头答到尾，与 t34 的两步法不同。不达标时先按二审归因（找材料还是作答），再与开发者讨论（决定 13：再议退回两步）。
- **风险：出处必须读过会让 Agent 多读、更容易撞 20 章上限。** S5 记录每题读过的章数与被退回的次数；撞上限的比例高时报告开发者。
- **风险：回归耗时。** 216 份多轮作答走 luna 渠道，按 t03 Skill 评测的速度约数小时；脚本可续跑。
