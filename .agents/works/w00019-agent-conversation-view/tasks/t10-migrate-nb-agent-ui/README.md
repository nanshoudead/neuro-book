---
schema: nbook.task/v2
taskId: t10-migrate-nb-agent-ui
status: active
updated: 2026-10-22
---

# 对话视图迁入 nb-agent-ui

## 目标与范围

把 t03 到 t09 已做的对话视图一次迁进新包 `nb-agent-ui`：来源是归档提交 `865c9f593` 的 `packages/neuro-book/app/components/agent/`（含 t09 的分目录与输入框）。通用零件进 nb-ui，Lab 场景、假数据与时间线回放迁进新应用的 Component Lab（组件树一组 `nb-agent-ui`）。行为不变，只换位置、断开旧应用的依赖（Nuxt 的 `useI18n`、旧 `renderMarkdown`、UnoCSS 图标类名），并加 harness 适配器（harness 的消息与流式事件合成视图消息），供 nb-story 与主应用共用。

合同：归档的 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md) 搬回 `docs/specs/ui/`（planned），owner 改为 `nb-agent-ui`；迁移不改行为。

## 决定

开发者 2026-10-21 定（背景见 [Work README](../../README.md#重新打开开发者2026-10-21)）：

1. 包名 `nb-agent-ui`，单独建包，不进 nb-ui 子路径。
2. 一次迁完已做的全部，不按问答需要裁剪。
3. nb-form、nb-agent-ui 都在新应用的 Lab 里看，做法同 nb-ui。

## 当前状态（2026-10-22）：S0 到 S6、实现审查与质量审查第一类的修正都已提交，等开发者在 Lab 确认

执行位置：worktree `.worktree/w00019-nb-agent-ui`，分支 `feat/w00019-nb-agent-ui`。计划见 [plan.md](plan.md)，开发者同意“先审查然后实施”；omp 设计审查 11 条已处理（[报告](evidences/design-review.txt)，处理结果见计划开头）。

| 片 | 提交 | 内容 |
|---|---|---|
| S0 | `528f9afc6` | 包骨架、边界与图标机检、仓库与 CI 登记；Spec 在 master 搬回（`522860436`） |
| S1 | `e80d5878b` | nb-ui 的 `CodeBlock`、`CollapsibleCard`、`CollapsibleRow`、`useStreamScroll` 与 Lab 场景 |
| S2 | `59e0bc7e8` | 核心：视图合同、注册表、分轮等纯逻辑、中英文字表、`ports.ts` |
| S3、S4 | `45fcc8014` | 渲染层：全部组件、注入与缺省实现、Markdown 的点击、样式改用 token；输入框随它一起迁（拆开编译不过） |
| S5 | `eeb31fb8c` | 应用接入：Lab 组件树 `nb-agent-ui` 一组、场景与领域工具登记示例、编辑器端口类型断言、`lab-agent-ui.e2e.ts` |
| S6 | `e6c4f1a4a` | harness 适配器 `createHarnessTranscript`、对真实 harness 的契约测试（普通完成、收尾工具、缺密钥、停止、免费与单价未知）、Lab 的“harness 记录回放”场景 |

| 审查修正 | `b0dca0903` 到 `c2a6df7ca` | 前端 14 条、核心与适配器 11 条的处理（下文“实现审查”）；`567f12d27` 把折叠行与卡片的事件统一为 `update:expanded`（开发者定） |

实现审查（2026-10-22）：前端 Sonnet 14 条（重要 6、建议 8，[报告](evidences/impl-review-sonnet.txt)），核心与适配器 omp 11 条（重要 10、建议 1，[报告](evidences/impl-review-omp.txt)；omp 中途两次因上游额度退出，续跑补完）。

- 成立并修改：前端 1 到 3、5 到 12，核心全部 11 条。
- 前端第 4 条（折叠行与卡片和 `Collapsible` 的协议不一致）：交开发者定，改为 `update:expanded`，可以 `v-model:expanded`。
- 不改：
  - 前端第 13 条：分轮与注册表的测试要用内置工具的真实登记，登记引用了组件，所以在 Vitest 里跑；缺的组件测试已按第 6、9 条补上。
  - 前端第 14 条：英文复数（“Read 1 files”），旧应用就有，记为后续。
- 关键修正：
  - 视图自己的文字跟 `locale`：Vue 的 `inject` 看不到本组件 provide 的值，`provideAgentView` 改为返回文字函数。
  - 思考与提醒在注入的 Markdown 里仍是淡色小字：颜色与 `--markdown-font-size` 写在注入组件的根上，`ports.ts` 写明。
  - 原图预览关掉即归还、取消不误报；重试不给 `blob:`、`data:` 加参数。
  - 适配器：
    - 停止时没有助手消息也补一条已停止；
    - 缺字段与不认识的事件记 `problems()`；
    - 晚到的工具事件不盖日志；
    - 按时间戳认正在生成的那条；
    - 用户消息图文按原顺序。
  - nb-harness 内置 `edit` 的 `input` 参数（补丁与 hashline）：认得改到的文件；补丁格式显示增删行，hashline 显示改完的那几行（结果正文不是 diff）。

质量审查（2026-10-22，开发者要求）：三个 Sonnet 分别从 API 形状、可维护性、易用性与缺失审 nb-agent-ui，共 47 条（[API](evidences/quality-review-api.txt)、[可维护性](evidences/quality-review-maint.txt)、[易用性与缺失](evidences/quality-review-complete.txt)）。开发者定分三类：

- **第一类，本 Task 里改完**：
  - 渲染器出错降级（Spec 验收 15）：工具渲染器的 `summary`、`groupPhrase`、`effects` 抛错时退回通用写法，宿主的 node、detail 组件抛错时只这一项显示“此内容无法显示”。计划原把验收 15 映射到注册表测试，实际没有实现，已在计划里改正映射。
  - 从输入框发出消息或命令后回到最新（Spec 历史与滚动一节与验收 4 各补一句）。补测时查出 nb-ui `useStreamScroll` 的竞态：写入 scrollTop 后、滚动事件派发前输入框变高，会被误判为离开了底部；自己写入引起的滚动事件不再重判是否跟随。
  - 文档过时：组件 `.md` 的导入路径、`preview-image` 的事件类型、`OriginalImagePreviewDialog` 的标签与旧应用描述、`teleportTarget` 两处类型不一。
  - `AgentChainSummary` 的事件改为 `update:expanded`。
  - `types.ts` 与 `ports.ts` 重复的菜单、附件、语言类型改为别名；核心入口改为显式导出清单，补上 `AgentTaskList` 属性要用的任务清单类型，渲染层入口导出 `PreviewImageRequest`。
  - 适配器 `messages()`：没被工具事件改动的消息保持同一个对象。
  - 窄屏：消息宽度不超过 400px 时助手一行不显示回复时间，模型名至少露出开头几个字。
  - 轮末用量的格式化挪进核心 `describeUsage` 并补单测；免费模型的费用显示为 `$0`。
- **第二类，新建 [t13](../t13-agent-ui-api/README.md)**：宿主组件通道、工具渲染器的结果标记、内置工具拆成数据与组件、收窄公开面、宿主起步套件、行为原则、拆分 `AgentTurnBlock`。先写计划交开发者确认，在 t11 之前做。
- **第三类，转 [t11](../t11-complete-view/README.md)**：没有消费者的扩展点由 t11 接上；无障碍、停止与复制反馈、Lab 夹具收拢、缺提供方的开发期警告、消息操作条溢出菜单进 S8。

与计划不同的地方：

- **6px 与 8px 的检查放进 e2e**：happy-dom 不算层叠样式，DOM 测试量不出计算后的内边距。
- **样式机检不查字号**：几处 10px 的角标字没有对应的 nb-ui token；其余字号都换成了排版 token。
- **原图预览不单独挂**：它带 `io:read`，Lab 不能单独挂载，经 `AgentConversationView` 验证（同旧版）。
- **`PlainPromptEditor` 上照常识别 `/命令`**：只是没有命令菜单。计划原写“命令按普通文字发送”，改成与 Spec 一致。
- **Spec 另补一句**：表里的 `subject_*`、`get_session` 等是 NeuroBook 的工具，由宿主登记。

验证（Work 分支，2026-10-22）：

- **质量审查第一类修正之后**（`a1a862d4e`）：nb-agent-ui `typecheck`、`test`（bun 62 条、Vitest 56 条）；nb-ui `test`、`typecheck`；应用 `typecheck`、`bun run test`（Vitest 403 条）；`docs:check`、`governance:check` 失败 0；e2e `lab-agent-ui`、`lab-scenes`、`lab-nb-ui` 共 33 条通过。变异检查：去掉工具回调与组件两层出错降级、适配器改回全量重建，相应用例失败；“发送后回到最新”一步在修 `useStreamScroll` 之前失败（离底 105px）。

此前一轮：

- **包**：审查修正之后重跑。nb-agent-ui 的 `typecheck`；`test` 通过（bun 58 条，含适配器单测与 8 条真实 harness 契约测试；Vitest 54 条）。nb-ui 的 `test`（552 条）、`typecheck` 通过。
- **应用**：`typecheck`；`bun run test` 通过（bun 1599 条、Vitest 403 条）。
- **e2e**：
  - `lab-agent-ui.e2e.ts` 19 条，加 `lab-scenes.e2e.ts` 全场景巡检、`lab-nb-ui.e2e.ts`，共 33 条通过（审查修正之后）。变异检查：对调 steer 与 followup、把过程区的行内边距改回 8px、去掉 Markdown 的淡色传递，相应用例都失败；视图的语言与预览归还、缺省输入框的 229 判断、适配器的两处修正也各做过一次。
  - `lab-scenes.e2e.ts` 全场景巡检通过。
- **截图**：`nbdev shot` 截了对话视图与输入框全部场景，手机与 1400×900、明暗各一，72 张没有溢出与页面错误。
- **文档检查**：`docs:check` 失败 0。

## 开工前已查明（2026-10-21，从代码读出，未运行）

- **迁移来源**：`git ls-tree -r 865c9f593 -- packages/neuro-book/app/components/agent/`，Lab 场景在同一提交的 `packages/neuro-book/app/component-lab/fixtures/Agent*`、`agent-conversation-fixture-data.ts`、`agent-composer-lab-host.ts`。`packages/neuro-book-legacy/app/components/agent/` 是 t09 之前的平铺旧版，不用。
- **要断开的依赖**：每个 `.vue` 都靠 Nuxt 自动导入的 `useI18n`（键 `agentView.*`）；`AgentMarkdown` 引旧应用的 `renderMarkdown`（marked 加一串旧应用模块）；输入框与用户消息引旧 `common/form/` 的 `PromptEditor`、`PromptTextView`。
- **新应用的对应物**：`nbook.markdown` 经服务 `markdownKey` 交出 `MarkdownDisplay`、`PromptEditor`、`PromptTextView`（`packages/neuro-book/src/plugins/markdown/shared/contracts.ts`）。`PromptEditor` 的接口是 `draft: {text, version}`、`enterSubmits`、`triggers`、`resolveMenu`、`commands`、附件与 `pastePolicy` 等，发出 `change`、`submit({mod})`、`token-activate`、附件事件；迁移时按它核对旧输入框的用法。nb-agent-ui 不能依赖应用包，这几个组件由宿主注入。
- **Lab**：场景用 `defineSubjectFixture` 登记在 `packages/neuro-book/src/plugins/lab/web/fixtures/index.ts`；组件树从包的 `lab-sources` 入口取文档与模块（`component-index.ts`，nb-ui、nb-form 都这样）。`fixtures/index.dom.test.ts` 要求每个可挂载组件至少一个场景，`e2e/lab-scenes.e2e.ts` 自动打开所有场景查错误与手机宽度溢出。
- **时间线回放在新应用里没有实现**：[`ui/component-lab-timeline.md`](../../../../../docs/specs/ui/component-lab-timeline.md) 是 planned，`LabFixture` 没有步骤字段，地址没有 `tl`、`at`；旧 Spec 写的 `smoke:component-lab` 只在旧应用里。依赖时间线的验收（归档 Spec 验收 19）要先补 Lab，或者改用别的验收方式，计划里要定。
- **nb-ui 的机检**：`token-consumption.test.ts`（圆角、时长、颜色、阴影都用 token，`var(--x)` 必须有声明）与 `icon-registration.test.ts`（`i-lucide-*` 必须在 `@iconify-json/lucide` 里，不能拼接类名）会扫所有 `.vue`；搬进 nb-ui 的零件要过这两条。图标是 nb-ui 的 `@iconify/tailwind4` 预生成类名。
- **nb-form 的边界测试**（`packages/nb-form/src/boundary.test.ts`）可照抄：核心只依赖 typebox，渲染层只依赖 vue 与 nb-ui。

- **契约测试与计划的差别**：脚本化模型一步给出整段，不发 `message_update`；“运行中画出流式消息”在契约测试里截到助手消息的 `message_start`，逐字更新由单测覆盖。

## 下一步

开发者在 Lab 确认（含 t09 第 2 步的输入框）。开发服务：`nbdev dev start` 起在 4317，组件树 `nb-agent-ui` 一组。确认后按开发者的安排合入 master，t11 开工。

后续建议（交付时报给开发者）：nb-form 的 `boundary.test.ts` 有同样的正则缺口（`branch-from` 误报、夹注释的导入漏报）；nb-form 不在 CI 的 workspace 选包矩阵里；英文文字的单复数。
