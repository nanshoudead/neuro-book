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

## 下一步

1. 按 plan.md 的切片 1 到 6 实施，每片单独提交。
2. 收口：nb-story 全量 e2e，派实现审查（前端 Sonnet、后端 omp），合入 master。
