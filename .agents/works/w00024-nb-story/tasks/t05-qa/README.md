---
schema: nbook.task/v2
taskId: t05-qa
status: active
updated: 2026-10-16
---

# nb-story 内置问答：网页问答页与 nbstory ask

## 目标与范围

在 nb-harness 上做 nb-story 的问答引擎：默认“图当目录”（挑章 Agent 用查询接口找出至多 20 章，再只凭这些章的原文作答），可选“全读”。网页问答页与 `nbstory ask` 共用这一个引擎。用 t34 的题回归，不劣于提案定的基线。

合同：[`story/qa.md`](../../../../../docs/specs/story/qa.md)（`planned`），连带改 [`story/queries.md`](../../../../../docs/specs/story/queries.md)（输出 15 搜索、问答记录）与 [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（`ask`、`qa` 命令与退出码）；`story/viewer.md` 的“不做问答”等网页问答页再改。依据：[剧情图谱提案](../../../../../docs/proposals/novel-story-app.md)第四节第 6 小节“问答”与 2026-10-15 的决策记录。

## 当前状态

- 2026-10-15：经 nbdev 新建（建时 slug 误写成 `t05-qa`，生成了 `t05-t05-qa`，已改名）。开发者定了方向（见“决定”）。
- 2026-10-16：Spec [`story/qa.md`](../../../../../docs/specs/story/qa.md) 与 [plan.md](plan.md) 提交（`0766e11fc`），开发者看过要点同意交审查；omp 设计审查。
- 2026-10-16：omp 设计审查 12 条（阻断 1、重要 9、建议 2），报告 [evidences/design-review.txt](evidences/design-review.txt)，全部成立，Spec 与计划已改：
  - 1（阻断）运行中删书时会话日志写失败：日志改在内存里，一问结束时与记录一起写下，运行期间书库里没有这一问的文件。
  - 2 并行 `read` 绕过章数上限：`read` 声明为 exclusive，同一条消息里依次执行。
  - 3 `maxChapters` 可调大到超过 20：限为 1 到 20 的整数。
  - 4 正文里的出处绕过校验：各段文字里“章.段”形状的内容也按同一账本校验。
  - 5 provider 错误回显密钥会落盘：在 nb-harness 里遮盖（harness Spec 输出 18 原本就要求密钥不进日志与结果，补写这半句与验收）。
  - 6 新写入口绕过书库版本门禁：`Library.writableBook` 统一检查，格式不认识时 `ask` 照答不存、`qa rm` 报 `unsupported_format`。
  - 7 工具参数“与命令同名”与“取方法参数”矛盾：定为方法的原生参数，命令表只复用名字、摘要与排版，说明里给 JSON 例子。
  - 8 19.6% 是 33/168 舍入后的数：门槛写成整数，168 份里错 33 份以内。
  - 9 沿用的评测检查器缺答也以 0 退出：新写 `qa-eval.ts`，三批各自声明份数，缺答、缺判、超门槛非零退出；送判格式写清。
  - 10 缺组合场景：验收补跨章、分次读的并集、并批两章、提醒与停止原因、删除的三种时序。
  - 11 镜像测试与措辞测试：去掉，改断言模型拿到的已知事实；规则效果交回归检验。
  - 12 Spec 混入实现与历程：原子写法、测试接缝、Profile 版本规则、字数与 token 的换算移出，证据只留批准依据。
  - 审查用的 worktree `.worktree/w00024-t05-review` 已删。
- 2026-10-16：开发者确认修订后的计划。实现在 worktree `.worktree/w00024-t05-qa`（分支 `feat/w00024-t05-qa`）：S1 搜索 `744c22751`；S2 固定一代、问答记录、nb-harness 遮盖密钥 `7eed50d65`；S3 问答引擎 `601ce95d8`；nb-harness 修正 `51a2486e4`；S4 命令行与包边界 `268dda9a0`；真实模型 Smoke 后的小修 `770a36078`。nb-story 193、nb-harness 73、nb-profile 17、nb-session 17 条测试通过，类型检查通过。和计划不同的地方：
  - 工具不按 sessionId 在进程里共享状态：每一问新建登记表，工具实现捕获这一问的状态。
  - 工具参数 schema 不写 `additionalProperties: false`：写了 OMP 会在调用前悄悄删掉多余字段，模型写了 `at` 得不到提示；现在 `at`、`book` 由工具明确拒绝。
  - nb-harness 新增 `onProcessInterrupt`（harness Spec 输出 19）：OMP 的 `pi-utils` 一被导入就装 SIGINT 处理，跑完登记的清理就以 130 退出，`process.on("SIGINT")` 拦不住，Ctrl-C 时“中断”的记录写不下来。
  - 修了 nb-harness 的竞态：OMP 异步投递事件，同一批并行工具里最后一条结果可能晚于下一次请求前的钩子，模型会收到缺结果的工具调用（真实服务会拒绝）。引擎测试偶发失败时发现，nb-harness 补了能稳定复现的测试。
  - `knowledge`、`statements` 等列表方法的 `query` 仍是整串匹配，模型照 `search` 的习惯写几个词会查不到；这次只在工具说明里写明；开发者定先保持整串匹配（决定 21）。
- 2026-10-16：真实模型 Smoke（gpt-6-luna，知情题 H24，阅读位置 27）：交卷，读第 26、27 章，用时 81 秒。前两次在第 4、9 次请求时遇上渠道的 `upstream_error`（没有状态码，归为 network），同一渠道 12 次小请求全部成功，判断为渠道偶发；问答本身遇到模型失败就以 `model_failed` 结束（Spec F2），回归脚本对这类失败整题重试至多 3 次。
- 2026-10-16：回归脚本 [scripts/qa-eval.ts](scripts/qa-eval.ts) 写好（answer、judge、check 三步，整数门槛，缺答缺判非零退出），等实现审查处理完再跑。omp 实现审查。
- 2026-10-16：omp 实现审查 10 条（阻断 1、重要 6、建议 3），报告 [evidences/impl-review.txt](evidences/impl-review.txt)，全部成立，修正 `8cfb86258`（nb-harness）、`94cf493de`（nb-story）：
  - 3（阻断）工具结果不能序列化后，同一会话下一次运行永远等那条结果、取消与关闭也挂住：写不进日志的消息让会话坏掉，之后的运行直接以 local 结束；取消、关闭会唤醒等待。
  - 6 系统提示词与消息出自两份历史：渲染挪到 `transformContext` 里只做一次，系统提示词经 `transformProviderContext` 换上同一次渲染的结果。
  - 9 等待时逐条回扫全部历史：改为记下已写进日志的工具结果 id。
  - 2 短于 8 个字符的密钥不遮盖：不论长短都遮盖，只排除“端点不要认证”的占位值。
  - 1 正文出处后跟英文句点、或写成全角就绕过校验：先 NFKC 归一，句末点号不再挡住识别。
  - 4 写门禁通过后换代，旧问写进新一代并报保存成功：改名之后再读一次代号，不是这一代就删掉刚写的文件、报没保存。
  - 5 一条损坏的记录让列表与删除都崩：损坏的列在最后、可以删除，显示报新的失败码 `qa_record_broken`（qa Spec F6）。
  - 7 写记录的本机错误逃出 `ask`：引擎里 harness 抛出的错误收成 `model_failed`（`local`），写盘失败照常给出答案、说明记录没保存（qa Spec“时序与寿命”补一条）。
  - 8 参数校验的退回没计数：真实模型 Smoke 时已发现并修好（`770a36078`）。
  - 10 `qa rm` 缺 id 时先查书库：先判用法再解析书。
  - 结果：nb-story 198、nb-harness 75（2 条真实模型用例跳过）条通过，类型检查通过；新加的测试都做过变异检查。审查用的 worktree 已删。
- 2026-10-16：第一次回归（`94cf493de`）没开推理，不算数，结果留作对照 [evidences/qa-eval-no-thinking/](evidences/qa-eval-no-thinking/report.md)：图当目录 56 题错 38/168（门槛 33）、16 题错 17/48（门槛 11），全读 16 题错 8/16；232 份都交卷，渠道 `upstream_error` 64 次全靠重试补上。原因是回归配置没写 `thinking`，请求不带推理档，这个渠道的默认档几乎不推理（每份输出约 1.7k token）；同一模型 `:max` 档的 Skill 评测是 3/48。全读也错一半、且与图当目录错在同几题上，说明错在作答而不在挑章。开发者定（决定 22）配置加 `xhigh`、回归用它重跑，先跑 16 题，达标再跑其余两批。
- 2026-10-16：`f87412c2f` 问答配置的 `thinking` 加 `xhigh`（qa Spec 的“配置”与验收 9 同步），本机端点测试核对请求里的 `reasoning_effort`；回归脚本改用 `xhigh`、`maxTokens` 64000（`e0894b784`）。单题试跑 H24 交卷，输出 4.9k token，推理已生效。
- 2026-10-16：第二次回归（`f87412c2f`，luna `xhigh`，`maxTokens` 64000），报告 [evidences/qa-eval/report.md](evidences/qa-eval/report.md)，232 份全部交卷、全部评分，渠道 `upstream_error` 靠重试补上：
  - graph56 一审答错 **11/168**（门槛 33），graph16 **4/48**（门槛 11），full16 全读 **1/16**（只记录）；不开推理时是 38/168、17/48、8/16。
  - 脚本判“不完整”（`CHECK_EXIT=1`）只因 graph56 有一份被标为“提到阅读位置之后”：A21（阅读位置 26）run3 的覆盖说明写“未涉及第27章及之后内容”，是声明没越界，不是泄露，出处全在第 26 章。这是检测规则（只认章号）的误报，等开发者定怎么处理。
  - 代价：开推理后每份用时中位 129 秒（graph56）、388 秒（graph16，题更难）、135 秒（全读），最长 1681 秒；graph56 平均读 8.1 章，15 份撞 20 章上限；被退回的份数 39/168、14/48、1/16。

## 决定

开发者 2026-10-15 在会话里定（t03、t04 合入之后）：

1. **提前做内置问答**：改掉 t02 决定 5（等 Agent 框架与 nb-harness 定了再做）。
2. **引擎建在 nb-harness 上**：挑章 Agent 用 nb-story 的查询接口当工具，经 nb-harness 的循环运行；以后接成插件不用换。计划阶段先核实 nb-harness 能否在包外单独使用，不行再回来问。
3. **入口**：网页问答页加 `nbstory ask`，同一个引擎；两种做法都可选，默认图当目录，原文超过上限时全读不可选（提案原样）。
4. **顺序**：先做问答（本 Task），再做 ingest（[t06](../t06-ingest/README.md)）。
5. **nb-harness 默认不带工具**：核实时发现 `createHarness` 总会挂上以 cwd 为根的读文件、改文件两个内置工具。开发者定：不加开关，nb-harness 默认就不该包含工具，工具全由调用方经插件给。改 `packages/nb-harness`（w00002 的包；目前只有它自己的测试调用 `createHarness`），读、改文件工具仍导出，要用的调用方自己装。
6. **Spec 假设**：会话里列的八条（防剧透、两种做法、挑章工具、答案格式、模型与密钥、过程与记录、回归门槛、Skill 不变）开发者确认“没有要改的”。
7. **前端组件**：对话、输入这类 Agent 组件用 w00019 在 Lab 里打磨过的那一套（现在在 `packages/neuro-book-legacy/app/components/agent/`），nb-story 与 NeuroBook 共用。
8. **先优化 nb-harness**：动 nb-story 之前，先看问答 Agent 要哪些能力、工具，要不要 TSX Profile，nb-harness 在这个场景好不好用。
9. **工具由 Profile 选（修订第 5 条）**：开发者看过分析后改定：nb-harness 可以有内置工具，用哪些由 Profile 决定；nb-harness 强制使用 Profile，nb-story 的问答也写 Profile。
10. **不加步数上限**：现在的模型很少失控，保持现状；以后有需要再在 nb-harness 里做失控保护。
11. **nb-harness 加单次请求**（不带工具的一次调用）。
12. **前端组件以后再议**：t05 先做 `nbstory ask`，网页问答页与对话组件的去处后续再讨论。
13. **问答改成一个 Agent 从头答到尾**（修订“两步”的假设）：查图、搜索、读原文的工具加一个作答工具，不再由程序按记录补章；全读是同一个 Agent 一开始就拿到全部原文。回归不达标再讨论退回两步。依据：t03 的 Skill 评测里外部 Agent 一个人查加读，知情 16 题一审答错 3/48，t34 两步法（v5）是 12/48。
14. **工具三层**：登记表（内置工具与插件工具，带命名空间、查撞名）、Profile 声明（带类型的引用，分必需与可选；缺必需工具时会话起不来、报 `tool_unavailable`；可选的缺了用 `<If tool>` 去掉相关提示词；Profile 可以自带工具）、用户配置（禁用）。会话开始时算出生效工具集，会话内不变。插件只贡献工具。
15. **搁置到后续 Task**：工具发现（OMP 的 `loadMode`、Claude Code 的延迟工具）、插件给所有 Profile 提供的公共工具（MCP）、配置里追加工具与审批；BM25 混合检索是否有效另开 Task 验证。

16. **Spec 要点**（2026-10-16 在会话里确认）：一问一个 Agent（TSX Profile `story-qa`），工具用命令行现成的文字格式；阅读位置由程序固定，读原文只到 P；全读是第一条消息带上 P 以前的原文；作答工具 `answer` 由程序校验、不通过退回；不调作答工具时最多提醒两次，再不交报 `no_answer`；规则 v5 加答案格式与“猜测、情境推断写成推断知道”；`nbstory ask` 进度走标准错误；记录存书库 `qa/`；配置 `~/.config/nbstory/config.json`；模型失败退出码 4；`search` 按词拆开按命中排序；回归门槛：gpt-6-luna 作答、t22 判分器 v2 一审，56 题各三遍答错不超过 19.6%，知情、身份 16 题各三遍答错不超过 11/48。
17. **图当目录一问最多读 20 个不同的章**，再读时工具拒绝。
18. **作答引用的出处必须是这一问读过的原文**，没读过的退回；全读时全部原文都算读过。
19. **全读模式只记录不设门槛**：知情、身份 16 题跑一遍。
20. **历史的查看与删除现在做**：`nbstory qa [<id>]`、`nbstory qa rm <id>`。
21. **列表方法的 `query` 先保持整串匹配**（2026-10-16）：`knowledge`、`statements` 等不跟 `search` 一起拆词，queries Spec 不改；工具说明里让模型每次给一个关键词。以后有需求再议。
22. **回归用 luna 的 `xhigh` 推理档重跑**（2026-10-16）：没开推理的那次结果留作对照；配置的 `thinking` 加 `xhigh`；先跑知情、身份 16 题，达标再跑 56 题与全读。开了推理仍不达标，再按决定 13 讨论退回两步。

## 下一步

1. 跑回归（S5），结果写进 `evidences/qa-eval/`。
