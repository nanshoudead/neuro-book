---
schema: nbook.task/v2
taskId: t07-low-code-forms
status: planned
updated: 2026-10-20
---

# 低代码：schema 表单与共用表单组件

## 目标与范围

全项目共用一套 schema 驱动的表单（设置、nbdev 提问、Agent 提问与审批、命令参数），并把 nb-ui 的表单控件改造成统一合同；生成式视图复用同一套组件

合同：[`docs/specs/ui/forms.md`](../../../../../docs/specs/ui/forms.md)（`ui.forms`，planned，S0 起草）。调研：[`docs/research/low-code-forms.md`](../../../../../docs/research/low-code-forms.md)、[`docs/research/generative-ui-openui.md`](../../../../../docs/research/generative-ui-openui.md)（Work 分支 `ce5d72e45`）。

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

2026-10-20 经 nbdev 新建；排在 t02 之前（t02 依赖它）。在 Work 分支 `feat/w00027-plugin-platform` 上实施：

- 先把 master 合进 Work 分支（`adbcff939`，拿到 w00029 的改名与删除），插件页改用 `Input`（`2d2ee4016`）；合并后应用 `bun test` 1547 例（一例已知的时好时坏用例，重跑通过）、Vitest 380 例、内核 342 例、nb-ui 505 例通过，typecheck 与 `docs:check` 通过。
- S0（`8d4f12cb1`）：Spec `ui.forms`、新包 `@notnotype/nb-form` 的骨架与登记（根 workspaces、`monorepo-boundaries.md`、根 `AGENTS.md`、包内 `AGENTS.md` 与 `README.md`）。偏离计划：Vue 层的测试配置与 `docs:check` 受管组件目录等 S3 有 Vue 组件时再加；`checkDescription` 返回 `{status, problems}`，Spec 已同步。
- S1（`b03e9f9a8`）：核心（字段树与控件选择、路径与不可变更新、校验与问题、条件显示、选项键、描述检查与 Agent 策略、终端退回、包边界测试），69 例通过，typecheck 通过；7 处关键行为做过变异检查，改回去测试都会失败。omp 的实现审查（[evidences/impl-review-s1-omp.txt](evidences/impl-review-s1-omp.txt)，17 条：重要 14、建议 3）全部成立，`7b0c74652` 修正：可为 null 的字段合并内外注解；引用只降级它所在的字段；每个字段自身的约束都报、整值检查不再跳过；必填完全由字段树处理，密钥豁免不再拼未转义的路径；JSON 字段接受合法的 null；显式 `json` 对任何种类成立；`additionalProperties: true` 与省略一样；允许重复的字面量数组改用 JSON 编辑；描述检查按 schema 结构遍历（名叫 `pattern` 的字段不再被拒）、完整检查 `x-form` 的形状与条件里的正则；Agent 策略计入组合器的嵌套与布局、根之下只许一层对象；布局只排根上的字段；非法路径不改值。Spec 同步（输出 1、2、3、8、13、23、验收 2，`fallbackWidget` 的类型）。nbdev 的文字按 UTF-16 计长度、去空白后非空、控制字符由 nbdev 的适配器以调用方问题报告，接入时在 dev-panel 里对照真实校验测。修正后核心 85 例通过，审查者的实验脚本重跑结果与预期一致。

- 可维护性整理（`53047e3ff`，开发者 2026-10-20 同意）：`x-form` 的形状收成一份 TypeBox schema（`hints.ts`），读取与检查共用；“哪种字段能写哪个控件”收成 `model.ts` 的一张表，`selectWidget` 与检查共用；共用守卫放 `guards.ts`，`fromPointer`、TypeBox 路径写法放 `path.ts`；校验拆成 `walkJson`、`walkObject`、`ownerOf` 等有名字的步骤，三处读 TypeBox 错误共用 `codeOf`。91 例通过，10 处变异检查都被测试拦下。

S2 起等 w00029 t04 合入 master。

## 下一步

计划 [plan.md](plan.md) 经设计审查（omp、Sonnet，见 `evidences/`）重写，并按 w00029 的改名与删除修订，开发者 2026-10-20 确认：表单出错的文字放在固定位置（字段只标红）；审批用展示态；一次做完再给 t02；按 w00029 的先后（S0、S1 现在做，S2 起等 w00029 t04 合入，w00029 t05 排在本 Task S3 之后）；设置的短选项改用横排 `RadioGroup`。接着做 S0：先把 master 合进 Work 分支。
