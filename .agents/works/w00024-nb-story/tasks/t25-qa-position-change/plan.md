# t25 计划：问答对话里调整阅读位置

## Context

开发者 2026-10-27 的决定（评审板 t21 第 4 题 A 加评语）：对话顶部“新对话按你现在的位置 N 回答”变成可点的控件；调整章节后，随下一次提问给助手发一条通用的 system-reminder，对话里把它显示成可点击展开的一条；对话里不写“下次提问时告诉助手”之类的话。系统提示里的示例：

```
<system-reminder>
阅读位置从第 27 回改为第 40 回。你可以访问 40 回及之前的位置了
</system-reminder>
```

依据与现状：
- 现行 Spec（`qa.md` 术语与限制）：对话是“同一本书、同一代、同一个阅读位置与做法下的若干轮”，中途不能改。引擎 `startContinued`（`src/qa/engine.ts`）用记录里的 `previous.at` 建 `ReadLedger`，所有工具按这个 P 裁剪；Profile 的 `initial.at` 写在第一条会话快照里，系统提示词“读到第 N 章”由它渲染，续问时从快照恢复。
- 所以做法是：**系统提示词不动**（它在会话快照里，改了会让续问判成不一致，也会让缓存失效），位置的变化用追加在下一条用户消息前的 system-reminder 告诉模型；**程序仍然是防剧透的最终防线**：每一轮的工具、读原文、交卷校验都按这一轮的 P 来，模型改不了。

## 技术选型

无新依赖。界面用 nb-ui 现有的 `Popover`、`Select`，对话里的提醒用 nb-agent-ui 已有的 `system` 消息（`source: "reminder"`）。

## 关键设计

### 引擎与记录（`src/qa/engine.ts`、`src/core/qa-records.ts`、`src/contract/qa-record.ts`）

1. `AskInput.at` 在 `continueFrom` 时不再是错误：给了就是这一轮的新位置（按 `book.info({at})` 规范化与校验，晚于已抽取位置时报原来的错）。**全读对话**（`mode: "full"`）不能改：全读的第一条消息把 P 以前的原文整段放进了会话，改了要补原文或重发，这里不做，报 `invalid_params`（命令行是用法错误），写明“全读对话的阅读位置不能改，开新对话”。图当目录对话可以改。
2. `startContinued` 的 `Start.at` 取新位置（没给取上一轮的位置，上一轮没有 `at` 的旧记录取 `previous.at`）。`ReadLedger` 用新位置建，已读范围 `previous.read` 先按新位置裁剪（位置往回调时，晚于新 P 的已读范围丢掉；章数上限 `maxChapters` 只数裁剪后仍有效的章）。位置往前调不裁。
3. **提醒是会话里独立的一条消息，位置一改就立刻写进会话日志**（开发者 2026-10-27 纠正：不是塞进下一条问题的同一条消息；他倾向“一到达就立刻进 session 持久化”）。新增动作 `setPosition(conversation, at)`（引擎入口 `changePosition`，网页 `qa.position`，命令行 `ask --continue <id> --at <位置>` 不带问题时也走它）：校验位置与对话（图当目录、不在运行中、没被别人同时追问）、往会话日志追加一条 `message` 条目（role `user`，文字是提醒，下面）和一条 `meta` 条目 `qa.position`（值 `{chapter, paragraph}`），再改记录。提醒文字（`章` 用位置的章号，带段号时写“38.57”；程序生成，不含用户输入）：
   - 往后调：`<system-reminder>\n阅读位置从第 27 章改为第 40 章。你可以访问第 40 章及之前的内容了。\n</system-reminder>`
   - 往回调：`<system-reminder>\n阅读位置从第 40 章改为第 27 章。第 27 章之后的内容现在不能访问或引用，即使前面的对话里出现过也不要再用。\n</system-reminder>`
   下一次提问时 harness 从会话日志恢复历史，提醒已经在里面，所以模型收到的是“……历史、提醒、问题”，提醒与问题是两条相邻的用户消息（不是一条）。位置没变时不写。连着改几次（27→40→35）就写几条，每条写“从 A 改为 B”，如实记录。新对话还没有会话时，选的位置就是第一问的位置，没有提醒。改位置不发模型请求、不产生费用。
4. 记录：`QaTurn` 加可选字段 `at: {chapter, paragraph}`（这一轮用的位置；新的轮都写，旧记录没有，读时回落到上一轮的位置再到 `conversation.at`）。`conversation.at` 仍是开始时的位置。`QaTurnResult.at` 取这一轮的位置。`qa.get`、`qa.list` 的“读到”显示用最近一轮的位置（`qa.list` 的 `at` 字段仍是对话开始时的，另给 `lastAt`）。
5. `ask --json` 的进度与结果带这一轮的 `at`；位置变了时 `ask` 的进度里写一行“阅读位置改为 N”。

不改：Profile 版本、工具声明、会话快照、`initial.at`（续问的一致性检查照旧）。

### 网页（`src/web/pages/QaPage.vue`、`src/web/qa/*`、`src/server/qa-service.ts`、`src/contract/contract.ts`）

1. `qa.start` 的输入：`conversation` 与 `at` 现在可以同时给（`at` 之外的限制照旧：续问仍不能带作答方式）；全读对话带 `at` 是 `invalid_params`。
2. 对话顶部那一行（`.qa-bar` 里的“读到 …”）变成一个按钮，点开 `Popover`：一个章节选择（1 到已抽取的最后一章）和“确定”。确定后：已有对话立刻调 `qa.position`（提醒马上写进会话并显示）；新对话还没有会话，只改页面里这条草稿的第一问位置（存在输入框存档 `composerStore` 里，原来是“跟随查看器的阅读位置”）。全读对话里按钮是禁用的，悬停写原因。
3. 对话里的提醒：会话日志里那条独立的用户消息，网页（`web/qa/turns.ts` 的 `composeMessages`）把整条文字严格匹配 `<system-reminder>\n…\n</system-reminder>` 的用户消息换成一条 `system` 消息（`source: "reminder"`，标签“系统提醒”，点开才看到全文），不开新的一轮、不算提问。位置控件点“确定”就调 `qa.position`（已有对话）；提醒随即出现在对话里。
4. `qa.list` 的行“读到 …”显示最近一轮的位置。

### 命令行（`src/cli/ask.ts`、`src/cli/commands.ts`）

`ask --continue <id> --at <位置>` 允许；`--mode` 与 `--continue` 同时写仍是用法错误。全读对话带 `--at` 是用法错误（退出 2）。

## Spec 与文档改动

`qa.md`：术语（对话的定义）、不变式 2（“P 在一问开始时定下”改成“在每一问开始时定下”）、输出 26（追问）与新输出（位置变化与提醒）、失败码、验收；`viewer.md`：问答页（位置控件、系统提醒显示）；`cli-skill.md`：`ask` 的选项表。

## 切片

1. 引擎与记录（含 CLI，`changePosition`）：`engine.ts`、`qa-records.ts`、`qa-record.ts`、`ask.ts`；测试用脚本化端点：往后调、往回调、全读被拒、旧记录没有 `at`、记录里的 `turns[].at`。
2. 网页服务与合同：`qa.start`、`qa.list`、`qa-service.ts`；测试：服务端测试（`server/qa.test.ts` 那一组）。
3. 网页界面：控件、待用位置、提醒拆分；`turns.test.ts`、`record-messages.test.ts`、e2e。

## 验收映射

| 判据 | 覆盖 |
| --- | --- |
| 改位置立刻在会话日志里追加提醒消息与 `qa.position` 条目、不发模型请求；下一问请求里历史带着提醒、工具按新位置 | `engine.test.ts`（本机端点收到的请求体与日志） |
| 往回调后新 P 之后的读原文、交卷出处被拒；已读范围按新 P 裁剪 | `engine.test.ts` |
| 位置没变不加提醒；全读对话改位置被拒 | `engine.test.ts`、`cli.test.ts` |
| 旧记录（turns 没有 at）续问正常 | `qa-records.test.ts`、`engine.test.ts` |
| 网页：控件改位置、对话里立刻出现可展开的系统提醒、刷新后仍在 | `qa.e2e.ts` |

## 验证

不调用真实模型：脚本化端点验证请求内容与程序侧的裁剪；“模型是否真的听提醒”留给真实模型验证（开发者批准后跑小样本，见下“不做与风险”）。

## 不做与风险

- 不做：全读对话改位置；书没抽完时读后续原文（t30）；对话里补“位置已改，下次提问生效”之类的文字（开发者要求不写）；章以下（段）粒度的选择（控件只选章，命令行可以写 章.段）。
- 风险：两条相邻的用户消息（提醒、问题）在个别提供方可能被合并或报错；OMP 的消息转换要核对（设计审查重点）。系统提示词里仍写着开始时的位置（快照里的），提醒写的是新位置——模型可能偏信系统提示词。缓解：程序按新 P 裁剪工具与交卷校验，越界必被拒，模型最坏是多试几次；提醒用明确的“现在”句式。要验证模型是否听话需要真实模型。
- 风险：往回调时，前面的对话里已经出现过之后的内容，模型仍“知道”。这是提醒能做到的上限（开发者的方案），不是程序能保证的剧透防线；Spec 要写明。


## 设计审查后的修订（2026-10-27，取代上文与之冲突的写法）

审查报告见 [evidences/design-review.txt](evidences/design-review.txt)。修订如下，实现以这一节为准。

### 数据模型

- `QaConversation` 加两个可选字段：`currentAt: {chapter, paragraph}`（下一问用的位置，缺省回落到最后一轮的 `at`，再回落到 `at`）与 `positionChanges: number`（位置改过几次，缺省 0）。`turns[].at` 只描述已经运行的那一轮，不改写历史。**当前位置的单一解析规则**：`currentAt ?? turns.at(-1)?.at ?? at`；引擎、`qa.get`、`qa.list`、命令行、控件、新提醒的“从 A”都用它（`core/qa-records.ts` 导出 `currentPosition(conversation)`）。**整个对话出现过的最高位置**：`highestPosition(conversation)` = `at`、每一轮的 `at` 与 `currentAt` 的最大者；剧透警告（列表的“晚于你现在的位置”、页头高亮）按它判断，位置往回调不会解除旧答案的警告（审查第 8 条）。
- 改位置在会话日志里追加**两条**：一条 `agent_message`（完整 OMP 用户消息形状 `{role: "user", content: [{type: "text", text: 提醒}], timestamp}`，**不是**旧的 `message` 条目，它恢复时不进模型历史——审查第 1 条，已用公开 harness 实验证实），紧接着一条 `meta`（key `qa.position`，值 `{chapter, paragraph, from: {chapter, paragraph}}`）。**网页识别提醒靠这个 meta 紧跟在 `agent_message` 之后**，不看文字（审查第 4 条：用户可以把同样的标签当问题提交）。
- 提醒文字不变（见上文）。

### 写入协议（审查第 2 条）

改位置与追问共用 `QaRecords.save` 的“复制新日志、记录改名发布”：`changePosition` 读记录与日志（`getWithLog`）→ 在内存里把两条追加到日志文本 → `save({...conversation, currentAt: 新位置, positionChanges: +1}, 新日志, {expectTurns: 现有轮数, expectChanges: 现有改动次数})`；旧日志发布后才删，失败时旧的一对原样保留。`save` 的冲突判据加上位置改动次数：`turns.length` 与 `positionChanges` 都要与开始时相同才发布，否则 `conflict`——运行中的一轮在改位置之后保存会得到 `conflict`（这一轮不保存，与现有“同时追问同一个对话”的语义一致）。为了不让用户撞上它：**对话在运行（页面）或已被占用（服务端的 `preparing`/`runs`）时，控件禁用、`qa.position` 返回 `qa_busy`**；跨进程（命令行与服务）靠 `conflict`，不做点击时的断言。

### 请求里合并相邻 user 消息（审查第 5 条）

DeepSeek 等端点拒绝连续的 user 消息，OMP 各传输层都原样保留。做法：日志与网页仍是独立的两条；`nb-harness` 在每次请求前（`transformContext`）把相邻的 user 消息合并成一条（文字块用空行连接），只改发给模型的上下文，不改日志。写进 `agent.harness` Spec。验收：本机端点收到的请求里提醒与问题是同一条 user 消息；日志里是两条；覆盖 Chat Completions 与 Responses 两种形状。

### 系统提示词（审查第 6 条）

问答 Profile 的系统提示词写着“只依据这个位置以前的内容回答”（位置取快照的 `initial.at`），向前调时与提醒冲突。在系统提示词里加一句：“阅读位置以对话里最近一条 `<system-reminder>` 写的为准，没有时以上面写的为准。”不升 Profile 版本（工具声明与快照不变，旧对话仍能续问；缓存前缀会变一次）。如实写进 Spec 的限制：**硬边界只有工具与结构化交卷的出处校验**；Markdown 作答（默认）的越界出处只标注、复查一次，没写出处的剧情程序认不出；往回调时对话历史里已出现的内容无法撤回。验收同时覆盖 Markdown 与结构化。

### 其余

- 控件的位置选项只给章（命令行仍可写 章.段）；新对话的控件改的是第一问的位置。
- `qa.position` 是新的服务端方法（`qa.start` 带 `conversation` 与 `at` 时先走同一条 `changePosition` 再运行这一轮，只保存一次）。
- Task README 的合同链接多一层 `../`（审查第 7 条）。

### 切片（取代上文的三片）

1. 数据模型与写入：`contract/qa-record.ts`、`core/qa-records.ts`（`currentAt`、`positionChanges`、`expectChanges`、`currentPosition`、`highestPosition`），测试：旧记录回落、冲突（运行中的轮保存时位置已改）、写失败保留旧的一对。
2. 引擎：`changePosition`、`startContinued` 用当前位置、`ReadLedger` 裁剪、`turns[].at`、系统提示词一句；`nb-harness` 合并相邻 user 消息；CLI `ask --continue --at`。测试：本机端点的请求体（合并后一条）、日志里独立两条、往回调越界被拒（结构化）、Markdown 只标注、全读被拒。
3. 服务端：`qa.position`、`qa.start` 带 `at`、`qa.list` 的 `currentAt`/`highestAt`、`qa_busy`。
4. 网页：位置控件、提醒按 meta 紧跟显示为可展开的“系统提醒”、剧透警告按最高位置、运行中禁用。e2e。
5. Spec：`qa.md`、`viewer.md`、`cli-skill.md`、`agent/harness.md`。
