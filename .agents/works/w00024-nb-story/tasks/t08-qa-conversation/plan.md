# t08 计划：可选的 answer 与连续对话

## Context

- **问题**：`nbstory ask 你好` 会失败。引擎要求模型用收尾工具 `answer` 交结构化答案，模型直接用文字回复时，程序提醒两次后以 `no_answer` 结束（[`story/qa.md`](../../../../../docs/specs/story/qa.md) 输出 7 到 10）。另外一问一个会话，不能追问。
- **由来**：开发者 2026-10-21 要求把问答接进网页，要有连续对话和简单的网页配置；网页另起 t13，本 Task 先做引擎与命令行。决定见 [README](README.md) 的“决定”：
  1. `answer` 留作可选工具，模型也可以直接用文字回复；
  2. 回归不重跑，只做真实模型冒烟。
- **期望结果**：
  - 问“你好”得到一段文字回复。
  - 剧情题照旧用 `answer` 交卷、校验、退回。
  - `nbstory ask <问题> --continue <对话 id>` 在同一个会话里接着问，模型能看到前几轮。
  - 记录按对话存，`nbstory qa` 按对话列出与显示。
- **依据**：[`story/qa.md`](../../../../../docs/specs/story/qa.md)（implemented）、[`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（输出 4 恢复会话、输出 8 历史保真、输出 13 到 16 收尾工具）。
- **约束**：
  - 代码在 w00024 的 worktree `.worktree/w00024-nb-story` 写，记录与 Spec 在主工作区改。
  - 真实模型冒烟由开发者批准（决定 3），预计不到 1 元。

## 关键设计

### 一问变成对话的一轮（`src/qa/engine.ts`）

- **入口**：`askQuestion(input)` 保留，`AskInput` 加 `continueFrom?: string`（对话 id）。
  - 给了 `continueFrom`：先读这条对话记录与会话日志。书、这一代、阅读位置、做法都取记录里的；调用方再给 `at`、`mode`，命令行按用法错误处理。然后用会话日志恢复 harness（不给 `initial`），`turn(问题)`。
  - 没给：和现在一样新建会话。
- **一轮怎么结束**（替换现在的提醒循环）：

  | 运行结束的方式 | 这一轮的结果 |
  |---|---|
  | `finished`（`answer` 通过校验） | 已答，带结构化答案 |
  | `stop`，最后一段助手文字不为空 | 已答，带文字回复 |
  | `length` | 已答，带文字回复，标记“输出到上限被截断” |
  | `stop`，文字为空 | 失败 `no_answer`（没交答案也没有文字） |
  | `error` | 失败 `model_failed` |
  | `aborted` | 中断 |

  不再发提醒，删掉 `REMINDER` 和 `reminder` 进度事件。
- **文字回复里的出处**：文字里写成“章.段”形状的内容，用 `refsInText` 与账本逐个检查，不合格的记进这一轮的 `unverifiedRefs`，不退回。理由：没有收尾工具，就没有退回的时机；阅读位置之后的原文 `read` 本来就读不到，越界出处只可能是模型编的数字，标出来就够了。
- **恢复不了**：恢复时 harness 抛 `session_incompatible`（Profile 版本或工具声明变了，旧记录就是这种情况），或者会话日志读不成，都在任何模型请求之前以新失败码 `qa_not_continuable` 失败（QaError，退出码 4），不写记录。
- **进度事件**：保持现在的 `tool`、`rejected`、`answered`；流式的文字与推理增量留给 t13。

### 账本跨轮（`src/qa/read-ledger.ts`）

- 读过的段在对话内一直有效，后面几轮可以直接引用。
- 章数上限按轮算：这一轮新读的、前几轮没读过的章不超过 `maxChapters`。
- `ReadLedger` 加两样：
  - `snapshot()`：导出读过的段，形状是按章合并的区间 `[章, 起段, 止段][]`；
  - 构造参数 `read`：恢复读过的段。
- 实现上把 `#read` 拆成“前几轮读过的”和“这一轮读过的”：前者只用来校验出处，章数只数后者里前者没有的章。`read` 的 exclusive 保证不变。

### 问答记录按对话存（`src/core/qa-records.ts`）

- **文件**：
  - 落点不变：`qa/<id>.json` 与 `qa/<id>.session.jsonl`，id 就是对话 id。
  - 每追问一轮，两个文件都整份重写。写法沿用现在的“临时文件加改名，先日志后记录”。
- **形状**（新写入的记录）：

  ```ts
  interface QaConversation {
      id; book; generation; at: Position; mode: QaMode; startedAt;  // 对话开始时定下
      turns: QaTurn[];                                               // 至少一轮
      read: [number, number, number][];                              // 读过的段（按章合并的区间）
  }
  interface QaTurn {
      question; status: QaStatus;
      answer: Answer | null;                                         // 用 answer 交卷时
      reply: {text: string; truncated: boolean; unverifiedRefs: string[]} | null; // 直接用文字回复时
      error: {code; kind?; message} | null;
      chaptersRead: number[];                                        // 这一轮新读的章
      rejections; usage: QaUsage; ms; model; startedAt;
  }
  ```

- **旧记录**：一问一条的记录（顶层有 `question`、没有 `turns`），读进来时换成一轮的对话：`read` 取空，`reply` 取 null，展示照常。它的会话日志是 Profile 版本 1 写的，续问时由 harness 报 `session_incompatible`，最后落到 `qa_not_continuable`。不做迁移，不改写旧文件。
- **防丢一轮**：`save(conversation, jsonl, {expectTurns})` 在改名之前再读一次磁盘上的记录，轮数不等于 `expectTurns` 就不写，返回“没保存”，新原因 `conflict`。这样后保存的那一次不会把对方刚存的一轮盖掉。读与改名之间还剩几毫秒的窗口，Spec 写进“不承诺”。理由：本机单人使用，同一个对话同时从两处追问极少；t13 的服务端在进程里按对话串行，用不到这个窗口。
- `recordProblem` 按两种形状核对，`list` 与 `get` 都返回 `QaConversation`。

### 内存会话日志能带着旧条目开始（`packages/nb-session/src/memory-log.ts`）

- `createMemorySessionLog({sessionId, entries?})`：`entries` 按原样放进日志，`seq` 必须从 1 连续，否则抛错。之后追加的条目接着编号。
- 导出 `parseEntryLine`（已有、未导出），nb-story 逐行解析保存的 JSONL：读不成的行当作日志损坏，按 `qa_not_continuable` 处理。
- 理由：“运行期间书库里不写东西”的不变量要保留（删书与写入不交错，见 `qa-records.ts` 模块头），所以续问仍在内存里跑，结束时整份写下。这只是包的公开函数多一个可选参数。

### Profile 与规则（`src/qa/story-qa.profile.tsx`、`src/qa/rules.ts`、`src/qa/tools.ts`）

- `manifest.version` 改成 `"2"`。
- `QA_RULES` 的“交卷”一节改成：
  - 回答小说的问题时用 `answer` 交卷，规则照旧；
  - 不需要查书就能回答的（寒暄、问你能做什么、问题不清楚要先问回去）直接用文字回复；
  - 追问可以引用前几轮读过的段落；
  - 文字回复里写的出处同样要是读过的段落。
- `ANSWER_RULES`（规则 v5）一字不改。
- `answer` 工具的说明去掉“必须”的口吻，其余（收尾、单独调用、校验）不变。

### 命令行（`src/cli/commands.ts`、`src/cli/ask.ts`、`src/cli/qa.ts`、`src/qa/format.ts`）

- **`ask`**：
  - 加 `--continue <对话 id>`；和 `--at`、`--mode` 一起写是用法错误（2）。
  - 标准输出给这一轮的答案或文字回复。文字回复后面列出“未核实的出处”，再写“对话 <id> 第 n 轮；追问：nbstory ask <问题> --continue <id>”。
  - `--json` 的 `data` 是这一轮的结果，原有字段保持原名（`id` 就是对话 id），新增 `turn`、`reply`，回归脚本读得照旧。
- **`qa`**：
  - 列表一行一个对话：id、时间、最后一轮的状态、轮数、第一轮的问题、P。
  - `qa <id>` 按轮显示整段对话。
  - `qa rm <id>` 删除整个对话。

## Spec 与文档改动

- **[`story/qa.md`](../../../../../docs/specs/story/qa.md)**：改动的条目都标“（planned）”。
  - 目标与非目标：一问改成一次对话的若干轮；`answer` 可选；“不承诺”加同时追问同一对话的窗口，以及旧记录不能续问。
  - 术语：对话、一轮、文字回复。
  - 命令：`ask --continue`。
  - 输出：1（对话与会话）、5（章数按轮算、读过的段跨轮有效）、7（可选）、8（只管 `answer`）、9（规则）、10（换成上面那张结束方式的表）、11（每一轮的结果），12 与 15 到 16（按对话），另加“文字回复里的出处”一条。
  - 状态与转换：按轮列状态；时序与寿命里的“读过的原文只在一问之内”改成在一个对话之内。
  - 失败与恢复：F4 的含义改成“没交答案也没有文字”；新增 F8 `qa_not_continuable`。
  - 验收：
    - 场景 4 改写成“文字回复与 `no_answer`”；
    - 新增“两轮追问”（第二轮的请求里有第一轮的问答，第一轮读过的段可以直接引用、不占第二轮的章数）、“旧记录不能续问”、“保存时轮数对不上就不保存”。
- **[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)**：命令表链接 qa.md，不用改；只核对 `ask` 的用法摘要。
- **包内文档**：nb-story 的 `AGENTS.md` 不变；nb-session 的模块头写明 `entries` 的用途。

## 切片

1. **nb-session 加 `entries` 与导出 `parseEntryLine`**：nb-session 的测试覆盖带旧条目开始、`seq` 不连续时报错、之后追加的编号接续。验证：`bun run --cwd packages/nb-session test`、typecheck。
2. **记录与账本**：对话形状、旧记录的读法、`expectTurns`；账本的导出、恢复与按轮计数。验证：nb-story 的 `qa-records`、`read-ledger` 相关测试。
3. **引擎与 Profile**：结束方式、续问、`qa_not_continuable`、规则 v2。验证：`engine.test.ts` 用脚本化模型。
4. **命令行**：`ask --continue`、输出、`qa` 的列表与显示。验证：`ask.test.ts`、`cli.test.ts`。
5. **真实模型冒烟**：见“验证”。

每片一次提交。2 到 4 片在同一包内，测试一起跑 `bun run --cwd packages/nb-story test` 与 typecheck。

## 验收映射

| Spec | 测试 |
|---|---|
| qa 输出 1、新增的续问条目 | `engine.test.ts`“两轮追问”：第二轮请求的消息里有第一轮的问题与答案 |
| qa 输出 5 | `engine.test.ts` 章数上限分组加跨轮用例 |
| qa 输出 7、8 | 现有防剧透、作答校验分组（行为不变） |
| qa 输出 10、F4 | `engine.test.ts`“文字回复”：stop 带文字为已答；length 标截断；stop 空文字为 `no_answer` |
| 文字回复里的出处 | `engine.test.ts`：没读过的段与晚于 P 的数字进 `unverifiedRefs` |
| qa 输出 12、14，`--continue` 的用法错误 | `ask.test.ts`、`cli.test.ts` |
| qa 输出 15、16，旧记录 | `qa-records` 的测试：旧形状读成一轮、`qa` 列表与显示 |
| F8 | `engine.test.ts`：Profile 版本 1 的会话日志续问得 `qa_not_continuable`，不发模型请求 |
| 保存时轮数对不上 | `qa-records` 测试：两次从同一轮数出发保存，后一次 `conflict`，记录里是先保存的那一轮 |
| qa 验收 6（取消）、7（删书）、8（密钥） | 现有用例；取消与删书各加一个续问的变体 |

## 验证

- 单元与合同测试：nb-session、nb-story 全量，加 typecheck。
- 真实模型冒烟（gpt-6-luna xhigh，样例书，开发者已批准）：
  1. `nbstory ask 你好`：得到文字回复，记录状态为已答；
  2. `nbstory ask "苏天晴是谁" --at 30`，再 `--continue` 问“她后来呢”：第二轮能接住指代，出处都在第 30 章以前。
- 不重跑验收 9 的回归（开发者决定 3）。规则改了、`answer` 不再强制，剧情题的答对率可能变化，没有验证：在 Task 记录里写明。

## 不做与风险

- **不做**：
  - 网页、服务端接口、流式增量事件（t13）；
  - 对话中途改阅读位置或做法（要换就开新对话）；
  - 旧记录迁移；
  - 回归重跑。
- **风险**：
  - 模型对剧情题也改用文字回复。那样就没有结构化校验，只剩“未核实的出处”提示。冒烟时会看第 2 条是否仍用 `answer`。
  - 全读的对话每轮都带着全部原文，上下文增长快，超出时以 `model_failed`（`context_overflow`）失败，不另设上限。
  - 被中断的一轮留在会话日志里，下一轮接着跑时 harness 怎么还原它，靠 harness 输出 6、8 的保证；续问的取消用例会覆盖。
