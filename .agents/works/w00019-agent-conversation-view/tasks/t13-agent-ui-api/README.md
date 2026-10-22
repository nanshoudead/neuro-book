---
schema: nbook.task/v2
taskId: t13-agent-ui-api
status: active
updated: 2026-10-22
---

# nb-agent-ui 接口整理

## 目标与范围

按 t10 质量审查第二类：宿主组件通道、工具渲染器的结果标记、内置工具拆成数据与组件、收窄公开面、宿主起步套件、行为原则、拆分 AgentTurnBlock；先写计划交开发者确认，t11 之前做

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。切片 0 先补新条目与验收 20 到 25，再实现。

## 当前状态（2026-10-22）：切片 0 到 7 已提交，实现审查进行中

计划见 [plan.md](plan.md)（Opus 规划子代理起草，逐条对照代码核实过审查意见），开发者同日同意计划末尾的九项决定。设计审查 14 条（Sonnet，重要 5、建议 9）全部成立，已改进计划，处理见计划的“设计审查”一节，报告在 [evidences/design-review.txt](evidences/design-review.txt)。

执行位置：worktree `.worktree/w00019-nb-agent-ui`，分支 `feat/w00019-nb-agent-ui`，接在 t10 的 `a1a862d4e` 之后。

| 片 | 提交 | 内容 |
|---|---|---|
| 0 | master `f7917a2ef` | Spec：结果节点、宿主组件、`header` 与 `processDisclosure`、运行中投递、服务可选、工具名匹配与冲突，验收 20 到 25 |
| 1 | `04d488937` | 内置工具拆成核心数据与组件映射；登记项加 `diff`，删 `AgentFileDiffDetail`；按类别的联合类型；工具名冲突与最长前缀；通用参数读取导出；分轮与注册表测试回到 Bun |
| 2 | `27118d881` | 宿主组件收 `ctx`、`services`、`locale`，只发 action；原图预览改为视图内部的 `image.preview`；Lab `answer` 节点组件 |
| 3 | `c51444025` | 结果节点：整轮收起后仍露出，不计操作次数，答案之后的分隔线移到 trailing；复制发 `tool.copy` |
| 4 | `e550faa6d` | 拆 `AgentTurnBlock`（`AgentChainBlock` 与两种步骤行）；状态、时刻、代码块各收一处；原始视图 `$null`；缩进变量；输入框两块抽出 |
| 5 | `aa61283da` | `canSteer`、`canQueue`；没有模型时不显示下拉；`header`、`processDisclosure`；空消息流只在加载中显示加载 |
| 6 | `5c9a99f50` | `createAgentContext`、`applyComposerAction`、`acceptSubmission`、`builtinContributions`；两项服务可选；`transcript.run()`；README 最小宿主 |
| 7 | `f64b73712` | `/vue` 只导出视图与内置登记，内部零件经只给 Lab 的 `./lab` |

与计划不同的地方：

- **展开状态**：两种步骤行各自持有自己的展开状态，`useOpenSet` 只用于思维链、工具组与卡片（`live` 的默认值只落在这几处）。
- **`./lab` 是静态导出**：它只被 Lab 里本来就动态加载的 `host.ts` 与 type-only 导入引用，不需要按名动态加载。
- **e2e 的教训**：切片 1 的第一轮 e2e 跑的时候在改切片 2 的源码，Lab 的 e2e 读源码，混进了半成品；之后每片先暂存，跑完 e2e 前不改源码。

验证（Work 分支，每片提交前）：nb-agent-ui `typecheck`、`test`（最后一片 bun 126 条、Vitest 25 条）；应用 `typecheck`、Vitest 403 条；`docs:check` 失败 0；e2e `lab-agent-ui` 与 `lab-scenes` 每片通过（最后一片连同 `lab.e2e.ts` 共 39 条）。变异检查：验收 15 两层降级、验收 21 的 action 转交、结果之后的分隔线、模型下拉的隐藏、缺 `resolveTriggerMenu` 时的触发字符过滤，各改坏一次相应用例失败。

## 下一步

Sonnet 实现审查（范围 `a1a862d4e..f64b73712`）回来后逐条处理；之后请开发者在 Lab 看 `answer`、`running-live`、`running-no-steer`、`embedded` 四个新场景，连同 t10 一起合入 master。
