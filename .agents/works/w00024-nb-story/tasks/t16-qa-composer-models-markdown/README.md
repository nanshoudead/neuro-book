---
schema: nbook.task/v2
taskId: t16-qa-composer-models-markdown
status: active
updated: 2026-10-24
---

# 问答输入框单行与控件、模型目录设置页、Markdown 作答

## 目标与范围

输入框收成一行并加推理档、模型、上下文大小与插入引用；设置页按 OMP 目录选模型并能自定义服务商（选择界面做进 nb-agent-ui）；作答默认 Markdown、结构化可选

来自开发者试用 [t15](../t15-qa-reasoning-and-mentions/README.md) 后的反馈（2026-10-24）。

合同：会改 [`story/qa.md`](../../../../../docs/specs/story/qa.md)（配置的模型与候选、作答方式）、[`story/viewer.md`](../../../../../docs/specs/story/viewer.md)（问答页输入框、设置页）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（单行输入框、上下文大小、模型选择界面），可能还有 [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（检查文字回复、不通过再跑一次）；静态稿定了再写。

## 决定

开发者 2026-10-24 在会话里定：

1. 输入框加推理档、模型选择、上下文大小；`+` 号打开引用菜单（与 `@` 相同），不做附件；模式照旧只在新对话可选。
2. 模型目录用 OMP 包自带的那一份，另外可以自定义服务商；要出静态稿。
3. 作答默认 Markdown，结构化可选。
4. 单行输入框与模型选择界面先出静态稿。

开发者 2026-10-24 在评审板 [review](artifacts/review/index.html) v1 上定（答复 `20261024T022059034Z-f4bbc538`）：

5. 输入框始终一行（`composer-layout=row`，不选推荐的“长了分两层”）：正文变长时只有正文长高，控件贴在右下角。手机宽度一行放不下时照样折到下一行。
6. 模型目录用左右两栏（`catalog-layout=two-pane`，不选推荐的搜索列表）：左边服务商（带搜索与密钥状态圆点），右边这一家的模型表（接口、上下文、推理、图片、单价）。
7. 设置页“模型”一节按评审板的结构做（`settings-structure` 确认）：候选模型（一个默认，默认的旁边设推理档）、用到的服务商与密钥状态、自定义服务商（名称、接口、地址、密钥变量，模型可从服务读取或手动添加，目录认得的模型名自动带出参数）；密钥只认环境变量。
8. 目录列出全部服务商，要登录的灰掉不能选（`catalog-scope=all-but-login`）；没验证过的接口照常可选，出错按现有归类报。
9. Markdown 回复出处不对时自动让模型改一次（`markdown-recheck=once`）：这一轮要结束时检查出处，没读过或晚于阅读位置就带着问题清单让模型接着跑一次；重写的作为结果，第一次的留在过程里，还不对就照旧标出。

开发者 2026-10-24 在会话里确认计划：

10. 问答页默认 Markdown 作答即可，加不加开关都行（计划取不加：网页上改默认在设置的 `qa.answer`，命令行有 `ask --structured`）。
11. 单行版式只给 nb-story，NeuroBook 的对话视图不变；抽取模型不改成目录引用；Profile 升到 v4、t16 之前的对话不能续问，接受。
12. 按 autonomous-delivery 推进：计划审查（omp 管后端与计划，Sonnet 管前端设计），之后按切片实施。

## 当前状态

- 2026-10-24 开草稿 worktree `.worktree/w00024-t16-drafts`（分支 `t16/drafts`，不提交），第 1 轮静态稿发在评审板 [review](artifacts/review/index.html) v1，5 道题：输入框版式、模型目录版式、设置页结构、目录列哪些服务商、Markdown 出处自动改一次。草稿场地是 nb-story 包里的 `drafts-t16-stage.ts` 与 `drafts-t16-shoot.ts`（只在草稿 worktree）。
- 搭稿时发现：问答页没有设 `interaction.canChangeRuntime`，模式按钮一直禁用，网页上新对话切不到全读，e2e 没覆盖；本 Task 一起修并补 e2e。

- 2026-10-24 开发者答完评审板（决定 5 到 9）。

- 2026-10-24 计划 [plan.md](plan.md) 写好。开发者要求仿照 OMP 的做法，派 Sonnet 调研（[omp-research.txt](evidences/omp-research.txt)），关键结论在仓库的 OMP 18.2.5 上核对后改了计划：认证按 `authPolicyFor` 与 `providerEntry().envVars` 分四类、自定义模型按模型名从目录补参数、`/models` 发现、目录界面照 OMP 的 `/models`。开发者已确认（决定 10 到 12）。

- 2026-10-24 设计审查：omp 审后端与计划 19 条（阻断 2、重要 17，[design-review-omp.txt](evidences/design-review-omp.txt)），Sonnet 审网页与组件 16 条（重要 12、建议 4，[design-review-web.txt](evidences/design-review-web.txt)），逐条核实都成立，已并入 [plan.md](plan.md)（文末“设计审查的处理”）。主要改动：Profile v4 的 `answer` 改为可选、只在结构化对话里登记；能否续问按快照的 Profile 版本判；出处复查消息在网页上由 `composeMessages` 改成过程行，第二次出错或取消时保留第一次的回复；认证分类按优先级取第一个、运行时取密钥仍走 `getEnvApiKey`；配置加语义校验与空起点；推理档用 OMP 六档并夹档；抽取只在默认模型是 `openai-completions` 时回落；`models.discover` 用对话框里的值、建议值不写盘；上下文大小复用 `ctx.usage`；`+` 经编辑器端口 `openTrigger` 打开菜单；服务商对话框放 nb-story。取舍写进 [待确认清单](../../pending-confirmations.md) 7 条。实施在 `.worktree/w00024-t16`。

- 2026-10-24 切片 1 到 4 已提交（分支 `feat/w00024-t16-qa-composer-models`）：dfb331aa1 nb-harness 模型目录；112518bf6 配置第 2 版；6bbf19335 作答方式、出处复查、每轮选模型、Profile v4；097622402 选模型的接口与 `discoverModels`。对应 Spec 提交在 master（34831d835、4c12e8c38、7a55bb946、37f6ba4b8）。实施中定的几处：语义校验的目录查表由调用方传入（单独导入 pi-catalog 也会接管 Ctrl-C，`nbstory ingest` 不能加载它），所以抽取的回落收窄到自定义服务商；`qa.start` 给 `thinking` 时必须同时给 `model`；换接口的测试放在引擎测试里（要 Responses 端点）。nb-story 单测 439 条全过。

- 2026-10-24 切片 5 已提交（9aa9c3884）：nb-agent-ui 的单行版式、上下文大小（圆环加百分比：只有圆环时像加载中的转圈）、带触发字符的前置按钮（nb-markdown 的 PromptEditor 加 `openTrigger`）、`canManageModels` 与 `model.manage`、模型下拉的分组与不可用原因、模型目录 `AgentModelCatalog`；Lab 场景与 e2e（lab-agent-ui、lab-scenes 26 条）通过。Spec 在 master 774a867a1。截图核对时修了两处：控件对齐正文最后一行的中线（垫 6px）；Lab 里目录对话框按“紧凑”画布摆会被压扁，登记成撑满画布。

- 2026-10-24 切片 6 已提交（8f9027193）：问答页的单行输入框、选模型与推理档（换模型时往下夹；续问缺省接着用上一轮的模型）、上下文大小、`+` 插 `@`、“管理模型…”（输入框存档挪到模块里，回来草稿还在）、`canChangeRuntime` 修好（新对话能切全读）；设置页的候选与默认、服务商列表、模型目录与服务商表单（`ProviderDialog`，读 `/models`）；出处复查在网页上是过程里的一行；导入页预览写明“抽取要单独写模型”。Spec 在 master d3b0a3b7f。真实页面截图核对时修了：复查行标签与正文重复、用量很小时写 `<1%`、手机宽度下默认候选被推理档挤窄、服务商表单的模型表在窄屏被压扁。
- 收口验证：nb-harness 85 条、nb-story 单测 449 条、nb-agent-ui（bun 184 条、DOM 51 条）、nb-markdown 编辑器 DOM 测试、各包 typecheck、`docs:check` 无失败；Lab e2e（lab-agent-ui、lab-scenes）26 条通过；nb-story 全量 e2e 31 条通过，最后一轮修正后问答页 e2e 11 条再跑通过。证据：截图在本地 `shots/s5`、`shots/s6`。
- 2026-10-24 实现审查（审查 worktree 固定在 8f9027193）：
  - Sonnet 审前端 10 条（重要 2、建议 8，[impl-review-web.txt](evidences/impl-review-web.txt)）：
    - 成立、已改：目录每次按键整表重排（改成排序只随服务商重算，合成的六千个模型每次匹配约 3 毫秒）；选过的模型在设置里被去掉后输入框写“未选择模型”、发问被拒（改成回到默认，补单测与 e2e）；保存成功后刷新目录失败报“没有保存”；服务商表单改的参数保存前不生效、没保存过的推理模型设为默认时推理档被丢掉；e2e 补改推理档保存；出处复查行改从 `nb-story.reply-check` 元数据取出处、不解析给模型的文字，开头补提问时日志里的提问不再当复查；服务商状态在 nb-story 收成一个 `providerNote`（复用 `providerSelectable`，用不了的服务商变量有值也不算能用）、数字短写收成一个；`saveProvider` 的提示盖掉默认模型变化；删对话时清掉输入框存档；上下文大小跳过被停止或出错的消息；目录换了服务商后选中项回到“全部”；e2e 用到的目录模型加了说明来源的断言。
    - 部分成立：控件垫高 6px，审查按 13px 字号算应为 4.6px；Lab 里实测编辑器是 14px，6px 时字形中线与控件中线差 0.1px 以内，保留 6px、注释写明实测依据。折行后多出的垫高成立，已去掉。目录对话框的文案在 nb-agent-ui 里走 i18n，没有和 nb-story 共用一份。
    - 没改：服务端 `invalid_params` 的页面显示没有专门的 e2e。冲突那条用例已经覆盖了“没有保存”的错误通道，单独构造服务端拒绝收益小。
  - omp 审后端 3 条（重要 3，[impl-review-omp.txt](evidences/impl-review-omp.txt)）：
    - `/models` 响应体超时被分成“回应不是模型列表”：成立，响应体改在包的那层读完，补了慢响应体的测试。
    - `ask --thinking` 不带 `--model`：按 Spec 输出 12、40，命令行允许只给推理档（按模型往下夹），与 `qa.start` 的成对要求不同是有意的；但追查时发现续问只给推理档会换回默认模型，违反输出 40，已修并补引擎测试。
    - 配置初始化的两条交互测试超时：不成立。审查 worktree 没装依赖，测试解析到 master 上的旧 nb-harness（报 `clampEffort` 不存在）；在实现 worktree 里这 4 个文件连跑两遍 99 条全过。
  - 修正提交：41483d2f0（nb-agent-ui）、9e6ca226d（nb-harness）、51cd016a5、1f3850e05、c99c4c2a2（nb-story）。复跑：nb-harness 85 条、nb-story 单测 452 条、nb-agent-ui bun 184 条与 DOM 51 条、各包 typecheck 通过；nb-story 全量 e2e 30 条通过、新补的改推理档用例选择器写错（c99c4c2a2 改正），问答页 e2e 11 条再跑通过。

- 2026-10-24 合入 master（b265707b2，不 push）；审查 worktree 与草稿 worktree 已删。

## 下一步

1. 待开发者批准：Responses、Anthropic、Gemini 接口与真实服务 `/models` 的真实模型冒烟。
