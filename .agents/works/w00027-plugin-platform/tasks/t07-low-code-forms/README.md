---
schema: nbook.task/v2
taskId: t07-low-code-forms
status: planned
updated: 2026-10-20
---

# 低代码：schema 表单与共用表单组件

## 目标与范围

全项目共用一套 schema 驱动的表单（设置、nbdev 提问、Agent 提问与审批、命令参数），并把 nb-ui 的表单控件改造成统一合同；生成式视图复用同一套组件

合同：待写（新 Spec，设计稿确认后起草）。调研：[`docs/research/low-code-forms.md`](../../../../../docs/research/low-code-forms.md)、[`docs/research/generative-ui-openui.md`](../../../../../docs/research/generative-ui-openui.md)（Work 分支 `ce5d72e45`）。

## 开发者已确认的决定（2026-10-20）

1. 全项目共用一套低代码：设置（配置项与插件页面里的表单）、nbdev 的提问、Agent 向用户提问与审批、命令参数都用它。
2. 两种界面：
   - **schema 表单**（默认）：结构化的 JSON Schema（TypeBox）驱动，安全、可审查，覆盖绝大部分需求。
   - **生成式视图**：需要更多表达力时（Agent 对话流里 LLM 生成可视化程序）用，只做 Web，用不同源的沙箱 iframe 运行 LLM 生成的 TSX，经消息通道与宿主通信；不为 TUI 做抽象。它更像 Agent 的一部分，不在本 Task 做，记为后续，随 Agent 对话流重建；本 Task 只保证表单组件能打包进 iframe 使用（不依赖宿主的服务与全局状态）。
3. 两种界面复用同一套表单组件。
4. 表单组件改造现有的，不另起一套：nb-ui 的基础控件统一控件合同（`modelValue`、`disabled`、`readonly`、`invalid`、`id`、关联说明），补密钥输入、列表编辑器（含对象数组）、JSON 编辑、带单位的数字、只读展示；“字段”层（标签、说明、控件、错误，按 schema 选控件）在新的低代码包里；设置的 `SettingsRow` 这类业务外壳改为包住字段。外观收口在 t06。
5. 描述写法：和值的语义有关的提示（标题、说明、多行、密钥、选项名、单位、占位）写在 schema 里；布局另写、可以不写，不写时按字段顺序自动排。
6. 低代码主体是一个包（核心不依赖 Vue，Vue 渲染层用 nb-ui），不是 NeuroBook 插件：nbdev 面板是独立的 Vue 应用。表单是受控组件，数据由调用方管，动态选项由调用方传提供函数。条件显示写成数据（不执行表达式字符串）。
7. TUI：schema 表单的描述只写语义、不写外观，每种提示能退回到 schema 类型的通用画法，保证以后能画；本 Task 不写 TUI 渲染层。生成式视图不考虑 TUI。

## 当前状态

2026-10-20 经 nbdev 新建，尚未开工；排在 t02 之前（t02 依赖它）。

## 下一步

写设计稿与 `plan.md`（包结构、描述格式、nb-ui 控件合同改造清单、第一版字段与组件、与 t02、nbdev、审批的接口），要点交开发者确认后交设计审查。
