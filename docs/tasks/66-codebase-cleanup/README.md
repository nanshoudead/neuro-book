# Codebase Cleanup

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [CONTEXT.md](../../CONTEXT.md)：NeuroBook 稳定领域术语，清理时优先使用 Project Workspace、Project Path、Project SQLite、IDE Mode、Agent Mode 等词。
- [PROJECT-STATUS.md](../../PROJECT-STATUS.md)：仓库级当前状态，重大清理后需要同步。
- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md)：World Engine 当前阶段收尾记录。
- [docs/tasks/59-world-engine-workbench-redesign/README.md](../59-world-engine-workbench-redesign/README.md)：三栏 Workbench 设计与后续体验打磨记录。
- [docs/tasks/61-world-engine-workbench-real-api/README.md](../61-world-engine-workbench-real-api/README.md)：真实 Workbench API 接入与 follow-up 记录。

## User Request / Topic

- 自主整理、清理代码，规范代码，清理屎山，整理文档。
- 新开一个 task。
- 工作流程：
  1. 从 git、tasks 等地方查看相关变更，或自由浏览项目。
  2. 分析、评估，列出一组问题。
  3. 如果问题复杂，对这些问题逐个深入评估，获取更多相关信息。
  4. 从系统角度制定计划。
  5. 修复。
  6. 回到第一条或者直接退出。
- 所有记录写入 walkthroughs。

## Goal

对当前大规模 World Engine / 写作模式变更后的代码与文档做持续整理：识别浅 Module、过大的单文件、过时文档、重复逻辑和测试脆弱点，按风险从小到大逐轮修复，并把每轮证据、问题、决策、验证与后续 TODO 写入本 task walkthrough。

- Outcome：代码和文档更容易导航，关键 Module 的 Interface 更清晰，后续修改有更好的 Locality。
- Verification surface：每轮 walkthrough、相关静态搜索、必要的窄测试或类型检查。
- Constraints：不回滚用户已有变更；不做大补丁；不为清理而引入抽象；优先修当前证据证明的问题。
- Boundaries：优先整理 World Engine、主 IDE Workbench、Preview、写作模式入口和相关任务文档；其它模块只在证据强时进入。
- Iteration policy：每轮先审计，再选一个低风险、高收益问题修复；复杂问题先记录候选和设计，不直接拆大模块。
- Blocked stop condition：如果清理需要重写业务 Interface 或迁移大范围状态，但缺少产品决策，则停止在计划阶段并记录需要用户决策的问题。

## Current State

- Worktree 当前有大量未提交变更，包含 World Engine、写作模式、Agent、Project Workspace 模板和任务文档；清理时必须避免误改无关用户变更。
- World Engine 阶段已在 [Round 425](../56-world-engine/walkthroughs/2026-06-23-round-425-stage-closeout-audit.md) 做主路径收尾审计。
- 代码体量热点：
  - `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2334 行。
  - `app/pages/world-engine.preview.vue`：约 1083 行。
  - `app/utils/world-engine-preview.ts`：约 782 行。
  - `app/utils/world-engine-workbench-real.ts`：约 705 行。
  - `app/utils/world-engine-ide-entry.test.ts`：约 1755 行，仍包含大量源码字符串断言。
- 文档体量热点：
  - `docs/tasks/56-world-engine/README.md`：约 910 行，并且承担了大量历史 walkthrough 索引和 follow-up。
  - `docs/tasks/59-world-engine-workbench-redesign/README.md`：约 512 行。
  - `docs/tasks/61-world-engine-workbench-real-api/README.md`：约 468 行。

## Candidate Problems

1. **Workbench Dialog 是过深实现、过宽 Interface 的单文件 Module**
   - Files：`WorldEngineWorkbenchDialog.vue`、`world-engine-workbench-real.ts`、workbench-preview 子 Module。
   - Problem：真实 Workbench 的加载、筛选、草稿、确认、proposal、subject system sync、snapshot 和 slice composer 编排集中在一个 2000+ 行 Module；理解一个动作需要在大量 ref/computed/function/template 之间跳转。
   - Plan：先做只读切面分析，识别可稳定下沉的 session / API orchestration / draft state Module；不直接大拆。

2. **Preview 页面仍超过项目单文件约束**
   - Files：`app/pages/world-engine.preview.vue`、`WorldEnginePreview*` 子 Module、`world-engine-preview.ts`。
   - Problem：Preview 已拆一部分，但页面仍承担 Project/session/action 编排和 UI，继续扩展会降低 Locality。
   - Plan：优先评估是否能抽出 `useWorldEnginePreviewSession` 这类深 Module；如果只是一层 pass-through 就不抽。

3. **任务 README 仍混合“当前事实”和“历史流水账”**
   - Files：Task 56 / 59 / 61 README。
   - Problem：README 同时承担 current state、索引、旧 follow-up、历史结论，导致搜索结果噪音大，过时 line count / TODO 容易残留。
   - Plan：第一轮先校正明显过时状态；后续设计“README 放当前事实，walkthrough 放历史证据”的整理规则。

4. **Workbench 静态测试大量依赖源码字符串**
   - Files：`app/utils/world-engine-ide-entry.test.ts`、`app/utils/world-engine-workbench-preview.test.ts`。
   - Problem：测试对具体源码片段敏感，重构时容易因为无行为变化而失败，Interface 测试面不够深。
   - Plan：暂不大改测试；后续选 1-2 个 util 行为测试替代高噪声字符串断言。

5. **Project 删除 / old link 恢复语义分散在多个任务**
   - Files：Project Workspace delete 代码、Task 56 / 59 / 61、PROJECT-STATUS。
   - Problem：deleted marker、后台清理、旧链接 fallback 的当前合同分散在 walkthrough 中。
   - Plan：后续如继续整理，应沉淀到 `reference/workspace/` 或 Project Workspace reference，而不是继续堆 task README。

## Decisions / Discussion

- 第一轮不拆 `WorldEngineWorkbenchDialog.vue`。当前 worktree 很脏，直接大拆风险高，且会和已有未提交改动缠在一起。
- 第一轮先做文档规范化：把明显过时的 line count / follow-up 状态校正到当前事实，为后续真正拆 Module 留一个清晰起点。
- 第二轮和第三轮优先下沉 Workbench 内与 Vue 响应式状态无关的纯逻辑；只有删除测试证明复杂度会回流到调用方时才新增 util Module。
- 第三轮暂不抽请求编排 Module。`$fetch` pass-through 会是浅 Module，必须等 request token、busy/error/notice、状态回流规则能被同一个 Interface 收敛时再设计。
- 第四轮继续收拢 Workbench review issue 规则，把 overall / per-slice summary 下沉到 `world-engine-workbench-real.ts`，Dialog 只保留响应式组合。

## Verification / Test

- 第一轮以静态搜索和文档链接核查为主。
- 只有改业务代码或提取 util 时才跑窄测试。

## Implementation Walkthrough

- 2026-06-23：[Round 1 - Initial Cleanup Audit](walkthroughs/2026-06-23-round-1-initial-cleanup-audit.md)。
- 2026-06-23：[Round 2 - Workbench Session Utils](walkthroughs/2026-06-23-round-2-workbench-session-utils.md)。
- 2026-06-23：[Round 3 - Workbench Subject Stats Module](walkthroughs/2026-06-23-round-3-workbench-subject-stats-module.md)。
- 2026-06-23：[Round 4 - Workbench Review Summary Module](walkthroughs/2026-06-23-round-4-workbench-review-summary-module.md)。

## TODO / Follow-ups

- 深入评估 `WorldEngineWorkbenchDialog.vue` 的内部 Module 切分点。
- 评估 `world-engine.preview.vue` 是否应抽 session composable。
- 梳理 Task 56 / 59 / 61 的 README 与 walkthrough 分工，减少历史流水账噪音。
- 逐步把高噪声源码字符串测试替换成更深的 util / contract 行为测试；Round 3 已先把 subject stats 覆盖改成 util 行为测试。
