# Workflow Checklist

## Relative Documents Refs

- [Project Status](../../../PROJECT-STATUS.md)
- [Writing workflow emulation](../31-novel-writing-workflow-emulation/README.md)
- [Novel workflow implementation](../32-novel-workflow-emulation-implementation/README.md)

## User Request / Topic

- 用户询问“workflow”是什么，以及当前项目能否安装这类能力。
- 要求尽量不改动现有代码，把它做成一个新功能。
- 本轮采用保守落地方式：新增独立 Workflow 模块，步骤执行复用现有右侧 Agent，不新增独立后台调度链。

## Goal

在 Novel IDE 中提供一个 Project Workspace 级 Workflow 功能：

- 工作流定义保存在 Project Workspace `.nbook/workflows/*.yaml`。
- 运行记录保存在 Project Workspace `.nbook/workflow-runs/<workflowId>/*.json`。
- 前端左侧工具栏新增 Workflow 面板。
- 第一版支持安装内置“章节写作”工作流、启动运行、完成/跳过/重开步骤、记录步骤笔记，并提供章节写作运行器把目标正文、写作目标和执行策略一次性交给 Agent。

## Scope

### In Scope

- `shared/dto/workflow.dto.ts` 定义 workflow / run / step DTO。
- `server/workflow/workflow-service.ts` 提供文件型定义与运行记录服务。
- `/api/workflows` 和 `/api/workflows/runs` 系列接口。
- `WorkflowPanel.vue` 前端面板与左侧栏入口。
- Workflow 步骤提供“运行 AI”，把步骤说明、提示、当前选中文件和运行上下文发送给现有右侧 Agent。
- Workflow 面板顶部提供章节写作运行器：自动列出 `manuscript/*.md` 目标正文，允许填写本轮目标，并选择是否同步回补 Plot / World Engine、重大剧情分歧是否停下确认。
- 服务层测试覆盖默认工作流安装、运行和步骤推进。

### Out of Scope

- 独立后台 Agent 调度器、无人值守定时执行和失败重试队列。
- 绕过现有 Agent 工具权限直接读写 Manuscript / Plot / World Engine 文件。
- 可视化 workflow 编辑器。
- 多人协作、审批、定时任务、失败重试队列。

## Design Notes

- 第一版仍以 manual checklist workflow 为主，但每个步骤可以通过“运行 AI”交给现有右侧 Agent 执行。这样不改变现有 Agent 生命周期、工具权限、Project 文件写入规则，也不会引入新的数据库迁移。
- 章节写作运行器是第一版真正可用入口：它会确保默认 workflow 和 active run 存在，再生成完整写作任务提示词，要求 Agent 读取目标正文、Plot、World Engine、Lorebook 与前后章节，直接推进正文和必要项目文件。
- Agent 执行入口只负责发送结构化任务提示；实际读写仍走现有 Agent session、工具审批和文件历史链路。
- 2026-07-16 调整：Workflow 发送 Agent prompt 时复用当前右侧 Agent session，不再固定切换/创建 `writer` profile session；作者可以自己决定当前会话使用 leader 还是 writer。
- run 会保存步骤标题、说明和提示的快照，避免 workflow YAML 后续修改影响历史运行记录。
- 2026-07-16 增强：Workflow run 现在会记录绑定的 Agent session、目标正文、用户目标、运行前正文快照、Agent 工具调用快照和正文 diff 提案。当前 Agent 文件工具仍是执行即写入，因此 diff 接受层采用“运行前快照 vs Agent 写后文件”的审阅模型：接受表示保留当前文件，回滚会写回运行前内容，保存合并结果会写回 DiffWorkbench 的 merge 内容。
- 2026-07-16 收口：旧的 `Chapter Draft` 四步 checklist 已从用户界面移除；后端保留 `chapter-draft` 作为历史 run 文件路径的内部 id，但默认定义覆盖为单步 `Writing Run`，只服务于运行记录结构。
- 2026-07-16 交互调整：章节写作运行器主体改为编辑器下方的 VS Code 式底部面板；`Workflow` 不再占用左侧 Activity Bar 图标位，入口改为编辑器底部自己的 `Workflow` tab；顶部 `Agent` 按钮在普通 IDE 模式下恢复为开/关 toggle，避免右侧 Agent 面板展开后无法关闭。
- 2026-07-16 底栏适配：Workflow 底部面板高度改为可拖拽，默认高度降低；章节写作运行器改为宽而矮的横向表单；前端不再展示正文 Diff 和工具调用列表，Agent 完成后只记录完成时间。
- 2026-07-16 运行反馈：章节写作运行器发送后会清空“本次写作指令”；绑定的 Agent session 仍在回复时，“开始写作流程”按钮保持禁用并显示转圈图标。
- 后端复用 `ProjectSession` 生命周期守卫：未打开的 Project 返回既有 `PROJECT_NOT_OPEN` HTTP 语义。
- workflow id / run id 都限制为安全文件名，避免通过 API 输入越界访问文件系统。

## Changed Files

- `shared/dto/workflow.dto.ts`
- `server/workflow/workflow-service.ts`
- `server/workflow/workflow-service.test.ts`
- `server/api/workflows/index.get.ts`
- `server/api/workflows/default.post.ts`
- `server/api/workflows/runs/index.get.ts`
- `server/api/workflows/runs/index.post.ts`
- `server/api/workflows/runs/record.patch.ts`
- `server/api/workflows/runs/step.patch.ts`
- `app/composables/useWorkflowApi.ts`
- `app/components/novel-ide/workflow/WorkflowPanel.vue`
- `app/components/novel-ide/agent/AgentChatSurface.vue`
- `app/components/novel-ide/mock-data.ts`
- `app/components/novel-ide/agent/AgentChatSurface.vue`
- `app/components/novel-ide/NovelIdeSidebar.vue`
- `app/components/novel-ide/NovelIdeToolPanel.vue`
- `app/pages/index.vue`
- `app/i18n/locales/zh-CN.ts`
- `app/i18n/locales/en-US.ts`

## 2026-07-17 Runner UI Redesign

- 章节写作运行器改为扁平的底部任务编辑器，不再在底栏中嵌套大表单卡片。
- 目标章节以标题为主、路径为辅；默认跟随编辑器当前章节，手动选择后显示固定状态并可恢复跟随。
- 本轮写作任务会占用剩余高度并随底部面板拉伸；执行选项和主操作收口到任务区底部。
- 工具栏展示当前 Agent session、Profile 和模型；状态只使用真实可观测阶段：空闲、发送中、Agent 回复中、Agent 已结束。
- 新增紧凑运行历史弹层；发送后仍清空任务输入，Agent 回复期间按钮禁用并显示旋转图标。
- 布局使用组件容器宽度响应 Agent 侧栏开关后的实际可用空间。
- 删除此前 `v-if="false"` 隐藏的 Diff、工具调用、步骤卡片及对应前端读写逻辑。

## Verification

- 2026-07-17 章节写作运行器 UI 重构后，`bunx vue-tsc --noEmit --pretty false` passed。
- `bun test server/workflow/workflow-service.test.ts` passed.
- `bunx vue-tsc --noEmit --pretty false` passed.
- 章节写作运行器新增后再次执行 `bunx vue-tsc --noEmit --pretty false` passed.
- Workflow 改为复用当前 Agent session 后，`bunx vue-tsc --noEmit --pretty false` 与 `bun test server/workflow/workflow-service.test.ts` passed.
- 运行记录 / diff 提案 / 工具调用可视化增强后，`bunx vue-tsc --noEmit --pretty false` 与 `bun test server/workflow/workflow-service.test.ts` passed.
- Workflow 底部面板迁移和 Agent toggle 修复后，`bunx vue-tsc --noEmit --pretty false` passed.
- Workflow 底栏拖拽、横向低高度布局和移除 Diff/工具调用展示后，`bunx vue-tsc --noEmit --pretty false` passed.
- Workflow 发送后清空指令、按钮跟随 Agent running 状态后，`bunx vue-tsc --noEmit --pretty false` passed.

## Follow-ups

- 后续如果需要更自动化，可以在现有 workflow step 上新增后台 `agent_prompt` / `read_file` / `write_file` 等 step kind，但必须先设计权限、失败恢复和运行日志。
- 后续可以增加 YAML 编辑器或模板库；第一版先把定义文件暴露给 Project Workspace，便于人工修改和版本管理。
