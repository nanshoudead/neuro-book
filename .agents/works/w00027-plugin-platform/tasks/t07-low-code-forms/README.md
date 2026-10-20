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

- 可维护性整理（`53047e3ff`，开发者 2026-10-20 同意）：`x-form` 的形状收成一份 TypeBox schema（`hints.ts`），读取与检查共用；“哪种字段能写哪个控件”收成 `model.ts` 的一张表，`selectWidget` 与检查共用；共用守卫放 `guards.ts`，`fromPointer`、TypeBox 路径写法放 `path.ts`；校验拆成 `walkJson`、`walkObject`、`ownerOf` 等有名字的步骤，三处读 TypeBox 错误共用 `codeOf`。91 例通过，10 处变异检查都被测试拦下。omp 实现审查（[evidences/impl-review-refactor-omp.txt](evidences/impl-review-refactor-omp.txt)，9 条：重要 5、建议 4），`a06ffd603` 处理：引用字段里对象的必填与额外属性归到该字段（原来被整值检查丢掉，非法值零问题）；JSON 字段里不满足普通联合报新码 `no-match`，`not-in-choices` 只留给选项；写了却没生效的内建控件都报 `widget-mismatch`（检查对照选中的结果，控件表不再公开）；文字字段有 `options` 时写的 `select`、`search-select` 生效；`FormHints` 的数组与数组项都只读；`readHints` 仍收 schema；`schema-walk` 用共用守卫；补空多语言文字与非整数行数的测试。属性名带 `/` 时整值检查的去重有歧义（第 2 条）接受为限制：值仍至少有一条问题，写进注释。Spec 输出 2、8 与失败码表同步。93 例通过，8 处变异检查都被拦下。

- 2026-10-20 合入 master（`da4e006af`，见 Work 的“分支”一节），合进来的 master 已含 w00029 t04，S2 起开工。
- S2a（`a578d7d9c`）：`Field` 加组形态（根是 `div`，标题带 id），上下文加 `labelId`，`useFieldContext`、`NB_FIELD_CONTEXT_KEY`、`FieldContext` 从 `@notnotype/nb-ui/components` 导出；`RadioGroup`、`CheckboxGroup` 的组根读上下文写 `id`、`aria-labelledby`、`aria-describedby`、`aria-invalid`，`CheckboxGroup` 补 `role="group"`（Reka 的根不带角色，没有它 `aria-labelledby` 不算组名）并用 null 盖住给组里复选框的上下文；`Switch` 去掉缺省名称“开关”，id 取上下文的 `inputId`；`SegmentedControl` 根改 `role="radiogroup"`、去掉 `aria-pressed`。`RadioGroup` 本来就有横排，计划里的“加横排”不用做。
  - 影响清单：`Field` 的调用方 dev-panel 的 `NewWorkForm`、`NewTaskForm`（包着单选组的两处改成组形态，名字从读不出变成字段标签）、`AnswerForm`、应用的 `ProjectInfoDialog`，普通形态不变；`Switch` 的四处调用方（dev-panel `DocsSidebar`、应用的 `SettingsControl`、`PluginsPage`、Lab 的 `SampleSnippetsPage`）都自己给名字，不变；`SegmentedControl` 的二十多处调用方只按属性用，依赖旧 `role="group"`、`aria-pressed` 的只有 nb-ui 自己的一条测试，已按新角色改；`CheckboxGroup`、`RadioGroup` 只有 dev-panel 用（`QuestionControl` 不在 `Field` 里，接入低代码时再命名，见 w00022 followups）。
  - 验证：nb-ui 502 例（新 `field-names.test.ts`，3 处变异都被拦下）、dev-panel 461 例、nb-story 284 例与各自类型检查；应用类型检查、Vitest 382 例；设置、书架、nb-ui Lab、插件、Lab 场景五组 e2e 28 例。
  - 偏离计划：可访问名称在组件测试里核对 `aria-labelledby` 指向的元素与文字，没有写 Lab 的 Playwright 用例（Lab 场景的插槽只有一份预设内容，做不出组形态的场景）。
- S2b（`6b4dcb8ba`）：各表单控件加同名的 `invalid`（与字段上下文取或）；`Switch`、`Checkbox`、`CheckboxGroup`、`RadioGroup`、`Select` 加只读：可聚焦、写 `aria-readonly`，值由组件给定、交互不发出变化，下拉不打开浮层；出错时单选圆钮、开关轨道描红，复选组里的框经包内注入只描红（`aria-invalid` 只在组上）；`Input` 的“清空输入”、`NumberInput` 的“增加”“减少”改为可覆盖的属性（“展开选项”现行代码里已经没有）；新组件 `SearchSelect`（combobox 输入框加 `SuggestionMenu`，列表就是 t04 统一后的弹出列表）；Lab 加只读、出错场景与 `SearchSelect` 场景；`dist/nb-ui.css` 重新生成。
  - 偏离计划：`SecretInput` 不做（凭据搁置，没有使用方），Spec 输出 31 改为 planned，`writeOnly` 与 `secret` 的字段在此之前按文字画（master `b13673166`）；下拉只读时原想拦“逐字查找”，真实浏览器里浮层关着时 Reka 的逐字查找本就不生效，删掉了这道到不了的拦截，由 Lab 的 e2e 守住“只读时值不变”。
  - 验证：nb-ui 518 例（`readonly-matrix.test.ts` 10 例、`SearchSelect.test.ts` 6 例，只读的四处拦截各做变异都被拦下）；dev-panel、nb-story、应用的类型检查；nb-story 284 例与 e2e 19 例；应用 Vitest 382 例；设置、书架、插件与 Lab 各组 e2e 71 例，其中新增下拉只读、`SearchSelect` 两条；改动的六个控件在 nbook、macos × 浅、深 × 手机、自由画布下截图 288 张，没有溢出、焦点被裁或页面报错，截图在 `.local/agent/works/w00027-plugin-platform/tasks/t07-low-code-forms/reports/s2b-shots/`。看图时补了两处：`SearchSelect` 的输入框关掉拼写检查；单选组、开关、复选组原来出错时只有属性没有外观。
  - 审查：Sonnet 界面审查（[evidences/impl-review-s2-sonnet.txt](evidences/impl-review-s2-sonnet.txt)，16 条：重要 9、建议 7），`2d4ce992c` 处理 15 条：
    - 下拉以只读挂载、再改成可编辑后打不开（reka 在 setup 时定受控与否）：浮层开合改由组件持有、始终受控；开关、单选组同一机制，改成始终受控，没给值时自己记；
    - 没给值的复选组勾第二项丢第一项、复选框原生状态与值分叉：组件自己记勾选，受控而调用方不采纳时把原生框摆回去；
    - 勾选后出错不红（与选中色同特指度）：描红用 important，真实浏览器里量过边框是出错色；
    - `SearchSelect`：打开时全选已选项的名字（原来打字接在名字后面）；组字中不筛选、Enter 与方向键交给输入法；外框上的放大镜与箭头可以开合且不失焦；不继承属性，`aria-*` 转给输入框；列表的名字缺省指向字段标签（`SuggestionMenu` 加可选的 `labelledby`）；当前值行尾打勾（`SuggestionMenuItem` 加可选的 `checked`）；`name` 改在隐藏输入框上提交值；字重与 `Select` 一致；
    - 只读的开关、单选组、下拉不再画成可点，只读下拉鼠标点击也能聚焦；复选组的组上不写 `aria-readonly`（`group` 角色不支持），`aria-invalid` 留在组上（ARIA 1.2 里是全局属性，Spec 输出 27 定了标在组上）；删掉复选组里到不了的第二道只读拦截；
    - 五份文档“没有只读、出错状态”的旧话改成实际表现；补上审查指出的测试空白（下拉只读切可编辑、非受控的开关与单选组、非受控复选组累计、`SearchSelect` 的出错与全选与组字与外框与名字与隐藏值、字段必填到单选组、字段说明到开关），e2e 改用逐字键入并点箭头；Lab 加已勾选出错的复选框与出错的复选组。
    - 不改 1 条（第 12 条，`Field` 组形态误用在单个控件上会丢名字）：组形态只给组合控件，S3 的渲染层按种类选形态；给单个控件也补 `aria-labelledby` 会让名字里多出必填的星号，在 `Field.md` 写明适用范围。
    - 修正后 nb-ui 528 例、应用 Vitest 382 例、dev-panel 与 nb-story 类型检查、Lab 的 nb-ui e2e 12 例、设置、书架、插件、Lab 场景等 e2e 33 例通过。

- S3a（`b68fda7ad`）：nb-form 的 Vue 渲染层 `@notnotype/nb-form/vue`：`SchemaForm`、`SchemaField`、`widgetLayout`；字段外壳自己提供 nb-ui 的字段上下文（标题行要放“默认”、警告与清除），组合控件用组形态；内建标量控件（开关、确认、各种单选、多选、数字、单行、多行，密钥按单行）；选项编码、动态选项三态与“已不存在”；草稿与提交时机、`revision`、`commit()` 合成一个根值；展示态（折叠、复制）；问题汇总与聚焦。样式用 scoped CSS 加 nb-ui 的 token，不依赖宿主的原子类引擎。包的测试配置（Vitest、`*.dom.test.ts`）、`./lab-sources` 与 Lab 的 `nb-form` 一组场景；依赖边界测试扩到渲染层；`docs:check` 的受管组件加上 nb-form 渲染层入口（`components.md` 同步）。
  - 开发者 2026-10-20 确认的做法（Spec 输出 14、15、接口与 `recommend` 已同步）：必填缺失在字段失过一次焦点或调用方要求之后才显示；不可解析的草稿提交失败一次后才报；“推荐”写在选项说明里；新增 `summary`、`focusIssue(path)`、`SchemaField` 的 `labelledby`；数字严格解析，可选数字清空是清除；“已不存在”只用于动态选项，固定选项之外的值照样显示出来。
  - 偏离计划：对象、列表、JSON 与自定义控件、分组折叠留在 S3b，这一片不画这些字段；Lab 的“服务商连接”只有标量部分。
  - 顺带：`code-baseline.yml` 的路径清单漏了 `nb-form` 与 `nb-story`（master 上 scripts 的工作流合同测试因此失败），补上。
  - 验证：nb-form 核心 94 例、渲染层 27 例与两份类型检查（数字解析、合并提交、必填延后、卸载撤掉草稿问题四处变异都被拦下，渲染层越界导入也被拦下）；应用类型检查、`bun test` 1560 例、Vitest 382 例；scripts 111 例；`docs:check`、`governance:check`；Lab 的 nb-form、nb-ui、场景与 Lab 四组 e2e 32 例（新增 4 例：可访问名称与说明、汇总聚焦、`1.` 不提交与条件显示保值、展示态 Tab 顺序）；两主题 × 浅、深 × 手机、自由画布截图 96 张没有溢出或报错，看图后把“推荐”从选项名挪到说明。截图在 `.local/agent/works/w00027-plugin-platform/tasks/t07-low-code-forms/reports/s3a-shots/`。

- S3b（`b7825184a`）：结构控件。对象（一组成员、可整个清除）；字符串列表与对象列表（稳定身份、增删排序与 `Alt+↑ / ↓`、焦点落点与读屏播报、上下限、重复项、超过 50 项折叠分页）；左列表右详情（只挂载选中项的详情、新增项选中并聚焦详情、`SchemaField` 的 `v-model:selected`）；JSON 编辑；自定义控件（`defineFormWidgets` 登记、重名报 `FormWidgetError`、按名或按分选、没登记的名字退回内建控件、发出的值按提交时机提交）；分组折叠与“含 N 个问题”；展示态的结构。Lab 补全“服务商连接”，加列表、展示态列表、自定义控件场景。
  - 开发者 2026-10-20 确认（Spec 输出 17、19、21、22 已同步）：折叠的分组与未选中的详情不挂载，写坏的草稿随之丢掉；列表按内容认领传回的数组、焦点等采纳后再移；自定义控件另收 `labelledby`；展示态的复制只给多行、JSON 与长文字。
  - 过程中的发现：Lab 与设置的写回都会换成副本（经过 JSON 或 RPC），只等一个渲染周期焦点会落空，按对象比较也认不出自己发出的修改，Lab 的 e2e 暴露后改成按内容认领、采纳时再移焦点，happy-dom 里补了“晚些、以副本传回”和“不采纳”的用例。
  - 验证：nb-form 核心 94 例、渲染层 46 例（新增 19 例）与两份类型检查；列表身份、草稿随路径换位、自定义控件提交时机、折叠不挂载、焦点等采纳五处变异都被拦下；应用类型检查与 Lab 的 Vitest 48 例；`docs:check`、`governance:check`；Lab 的 nb-form、nb-ui、场景与 Lab 四组 e2e 36 例（nb-form 8 例）；截图 120 张没有溢出或报错，看图后收窄了展示态的复制按钮。截图在 `.local/agent/works/w00027-plugin-platform/tasks/t07-low-code-forms/reports/s3b-shots/`。

## 下一步

S3 的审查：Sonnet 审渲染层（界面、交互、可访问性），omp 审接口与核心衔接（提交、草稿、身份、自定义控件合同），并行。处理完做 S4（命令参数检查、隔离测试）与 S5（设置改用 `SchemaField`）。计划见 [plan.md](plan.md)。
