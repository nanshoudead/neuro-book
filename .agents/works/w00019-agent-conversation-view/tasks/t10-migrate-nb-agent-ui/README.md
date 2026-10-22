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

## 当前状态（2026-10-22）：S0 到 S5 已提交，S6（harness 适配器）未开工

执行位置：worktree `.worktree/w00019-nb-agent-ui`，分支 `feat/w00019-nb-agent-ui`。计划见 [plan.md](plan.md)，开发者同意“先审查然后实施”；omp 设计审查 11 条已处理（[报告](evidences/design-review.txt)，处理结果见计划开头）。

| 片 | 提交 | 内容 |
|---|---|---|
| S0 | `528f9afc6` | 包骨架、边界与图标机检、仓库与 CI 登记；Spec 在 master 搬回（`522860436`） |
| S1 | `e80d5878b` | nb-ui 的 `CodeBlock`、`CollapsibleCard`、`CollapsibleRow`、`useStreamScroll` 与 Lab 场景 |
| S2 | `59e0bc7e8` | 核心：视图合同、注册表、分轮等纯逻辑、中英文字表、`ports.ts` |
| S3、S4 | `45fcc8014` | 渲染层：全部组件、注入与缺省实现、Markdown 的点击、样式改用 token；输入框随它一起迁（拆开编译不过） |
| S5 | `eeb31fb8c` | 应用接入：Lab 组件树 `nb-agent-ui` 一组、场景与领域工具登记示例、编辑器端口类型断言、`lab-agent-ui.e2e.ts` |

与计划不同的地方：

- **6px 与 8px 的检查放进 e2e**：happy-dom 不算层叠样式，DOM 测试量不出计算后的内边距。
- **样式机检不查字号**：几处 10px 的角标字没有对应的 nb-ui token；其余字号都换成了排版 token。
- **原图预览不单独挂**：它带 `io:read`，Lab 不能单独挂载，经 `AgentConversationView` 验证（同旧版）。
- **`PlainPromptEditor` 上照常识别 `/命令`**：只是没有命令菜单。计划原写“命令按普通文字发送”，改成与 Spec 一致。
- **Spec 另补一句**：表里的 `subject_*`、`get_session` 等是 NeuroBook 的工具，由宿主登记。

验证（Work 分支，2026-10-22）：

- **包**：nb-agent-ui 的 `typecheck`；`test` 通过（bun 33 条、Vitest 46 条）。nb-ui 的 `test`（552 条）、`typecheck`、`build` 通过。
- **应用**：`typecheck`；`bun run test` 通过（bun 1599 条、Vitest 403 条）。
- **e2e**：
  - `lab-agent-ui.e2e.ts` 15 条通过。变异检查：对调 steer 与 followup、把过程区的行内边距改回 8px，相应用例都失败。
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

## 下一步

S6：harness 适配器、契约测试、Lab 的“harness 记录回放”场景。之后整体做一次实现审查（前端 Sonnet），交开发者在 Lab 确认（含 t09 第 2 步的输入框）。
