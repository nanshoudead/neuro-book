# 实施计划：低代码（schema 表单与共用表单组件，t07）

2026-10-20 起草，待开发者确认。

## Context

整个项目要用一套表单：设置（配置项、插件页面里的表单）、nbdev 的提问、Agent 向用户提问与审批、命令参数。现在各处各写各的：设置窗口有自己的 `SettingsControl`（按 schema 选控件，只会开关、选项、数字、单行文字，别的只读），nbdev 的四种题各有界面，Agent 还没重建；nb-ui 的表单控件写法不统一（有的有 `readonly`、有的没有，`SegmentedControl` 连 `disabled` 都没有，表示出错的 `invalid` 只有两个控件有）。t02（设置补齐）要的多行、数组、对象、JSON、密钥、动态选项，也正是这套表单该有的。

依据：
- 开发者 2026-10-20 的决定，见 [README](README.md) 的“开发者已确认的决定”：两种界面（schema 表单为默认；生成式视图另做，只做 Web，复用这里的组件）；改造现有组件、不另起一套；语义提示写在 schema 里、布局可选；做成包；表单受控、数据由调用方管；条件显示写成数据；描述能退回到 TUI 画法，但本 Task 不写 TUI 渲染层。
- 调研：[`docs/research/low-code-forms.md`](../../../../../docs/research/low-code-forms.md)、[`docs/research/generative-ui-openui.md`](../../../../../docs/research/generative-ui-openui.md)。
- 旧应用参照：`packages/neuro-book-legacy/server/low-code-form/`、`app/components/common/low-code-form/`（见“旧应用的低代码”）。
- 规范：[`packages/nb-ui/docs/ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)、[`docs/standards/code/components.md`](../../../../../docs/standards/code/components.md)。

## 技术选型

**自己写核心，建在 TypeBox 上；借用 JSON Forms 的几个概念，不引入它的包。** 理由（事实见调研）：

- 全项目的校验已经是 TypeBox（`Value.Check`、`Value.Errors` 给出 `instancePath`），表单的校验与错误定位直接用它；JSON Forms 要 AJV，等于两套校验器、两种错误格式。
- JSON Forms 的 Vue 绑定还是预览版，控件要全部自己按 nb-ui 写一遍；它真正省掉的只有“按 schema 选控件的打分规则”与“没有布局时自动生成布局”，这两样写起来都不大。
- 它的界面描述以独立 UI schema（`scope` 指针）为主；我们定的是语义提示写在 schema 里、布局可选。
- Formily、vue-json-schema-form 的条件显示用 `new Function` 执行 schema 里的表达式字符串，不能用（描述可能由 LLM 生成）；FormKit 不是 JSON Schema。
- 借用的概念：按“类型 + 提示”给控件打分选最合适的（JSON Forms 的 tester）；条件写成一段 JSON Schema、对另一个字段的值求值（JSON Forms 的 rule），不执行代码；没有布局时按字段顺序自动生成。
- 旧应用也是在 TypeBox 上自己写的。

这一条请开发者确认（“实施前先做技术选型”）。

## 旧应用的低代码

旧应用有一套（服务端 `defineLowCodeForm`、前端 `LowCodeForm` 加九种字段控件），给 Agent Profile 的设置用。逐项决定：

| 旧机制 | 它防什么或解决什么 | 新设计 |
|---|---|---|
| schema 之外另写 `fields` 列表，每项写明 `component`、标签、选项 | 字段顺序与控件由作者定 | 改为语义提示写在 schema 里，控件按类型自动选，需要时 `widget` 指定；布局可选 |
| 选项提供者在服务端执行，解析成 DTO 再发给前端 | 选项来自服务端数据 | 保留“动态选项”，但由调用方提供（在哪里取数据由调用方定），表单不发请求 |
| `issues` 带 `severity: error / warning` 与路径 | 服务端的校验结果显示到字段上 | 保留，并与 TypeBox 的错误统一成同一种问题格式 |
| 表单级 `validate` 钩子 | 跨字段的校验 | 保留，由调用方提供 |
| 作用域继承（项目“跟随全局 / 自定义”，`overridePaths`） | 项目层覆盖全局层 | 不放进表单：这是设置的层语义，由 `SettingsRow` 这类外壳处理（新设置已有用户层、本作品层） |
| `resource-preset` 字段（选、建、改一份 Markdown 资源） | Agent Profile 的提示词资源 | 不在第一版；它是一个自定义控件的例子，Agent 重建时经控件登记加回 |
| `LowCodeFieldShell`（标签、说明、错误的统一外壳） | 各控件共用排版与错误呈现 | 保留，即本计划的“字段”层 |

## 关键设计

### 包：`packages/nb-form`（新）

`@notnotype/nb-form`，两个入口：
- `.`（核心）：只依赖 `typebox`，不依赖 Vue，浏览器、服务端、将来的 TUI 都能用；
- `./vue`（Vue 渲染层）：依赖 `vue` 与 `@notnotype/nb-ui`。

不放进 nb-ui：nb-ui 是基础组件库，表单的描述格式、校验、条件求值与 Agent 用的描述检查不属于它；放进去会让只要一个按钮的使用方也带上这些。新包要登记到 `docs/modules/monorepo-boundaries.md` 与根 `AGENTS.md` 的结构图。

### 描述格式：`packages/nb-form/src/description.ts`

数据仍是 TypeBox（即标准 JSON Schema）。界面提示分两类：

- 用 JSON Schema 自己的关键字：`title`、`description`、`default`（只供表单显示“默认”，不由表单填入）、`readOnly`、`writeOnly`（密钥）、`examples`、`minimum` 等约束、`format`。
- 其余放在一个命名空间键 `x-form` 里：

```ts
interface FormHints {
    label?: Text;            // Text = string | LocalizedText；有 label 时盖过 title
    help?: Text;             // 盖过 description
    placeholder?: Text;
    unit?: Text;             // 数字的单位
    widget?: string;         // 指定控件："multiline" | "secret" | "json" | "radio" | "segmented" | "select" | "checkboxes" | "tags" | "list" | "master-detail" | "confirm" | 登记的自定义控件名
    choices?: ReadonlyArray<{value: string | number | boolean; label: Text; description?: Text}>;  // 字面量联合的选项名
    options?: string;        // 动态选项：调用方提供的选项源名
    visibleWhen?: {field: string; schema: unknown};   // 另一个字段（相对路径）的值满足这段 JSON Schema 时才显示
    itemLabel?: string;      // 对象数组：用哪个字段当每一项的标题
    recommend?: ReadonlyArray<unknown>;  // 推荐的值（nbdev 的“推荐”）
    rows?: number;           // 多行文字的初始行数
    fallback?: string;       // 自定义控件在不能画的地方退回成哪种内建控件
}
// 写法：Type.String({title: "API Key", writeOnly: true, "x-form": {placeholder: "sk-…"}})
```

- 布局（可选）：

```ts
type FormLayout =
    | {type: "field"; path: string}
    | {type: "column" | "row"; items: FormLayout[]}
    | {type: "group"; label: Text; collapsed?: boolean; items: FormLayout[]};
```

没给布局时按对象属性的顺序自动排成一列；`x-form` 里不放宽度、颜色这类外观。

### 核心：`packages/nb-form/src/`

```ts
resolveForm(schema, {layout?, hints?}): FormModel     // 解析成字段树：每个字段的路径、种类、选中的控件、提示、是否必填
selectWidget(node, registry): WidgetChoice           // 按“种类 + 提示”打分选控件；登记的自定义控件参与打分
validateForm(schema, value, {extra?}): FormIssue[]   // TypeBox 校验，错误换成 {path, code, message, severity}；extra 是调用方的跨字段校验
isVisible(node, value): boolean                      // 求 visibleWhen：用 Value.Check 对那个字段的值检查那段 schema，不执行代码
checkDescription(schema, layout?, policy?): DescriptionProblem[]   // 检查一份描述能不能用：有没有画不了的类型、布局路径对不对、policy 不允许的控件（例如 Agent 生成的描述里不许有 secret）
fallbackWidget(widget, target): BuiltinWidget         // 控件在别的画法里退回成什么（给以后的 TUI；本 Task 只给数据与测试）
```

字段种类（按 schema 推出）：布尔、字面量单选、字面量多选（字面量联合的数组）、数字、整数、字符串、字符串数组、对象、对象数组、未知（兜底用 JSON）。可选属性的值为 `undefined`，表单不补默认值。

### Vue 渲染层：`packages/nb-form/src/vue/`

```ts
<NbForm :schema :layout? v-model :mode="'edit' | 'readonly'" :issues? :options? :widgets? :locale />
<NbField :schema :path? v-model :mode :issues? :options? :widgets? :locale />   // 一个值；设置的一行用它
```

- `options`：`Record<选项源名, Readonly<Ref<ReadonlyArray<选项>>>>`，由调用方给；`widgets`：自定义控件登记（名字、组件、打分函数、退回控件）。
- 字段外壳 `FormFieldShell`：标签、必填、说明、控件、问题；用 nb-ui 的 `FormField` 的上下文把 `id`、`aria-describedby`、`invalid` 交给控件。
- 结构控件（递归的）放在本包：对象（一组字段，可分组、折叠）、字符串数组（逐行列表，增删排序）、对象数组（列表；`master-detail` 是左列表右详情）。
- `readonly` 模式：每种控件都有只读画法，给审批视图用；审批的“同意 / 拒绝”按钮不在表单里，由调用方画。
- 组件不依赖宿主的服务、全局状态与 `inject` 的应用级数据（只用 nb-ui 自己的 `FormField` 上下文与主题），以后能打包进生成式视图的 iframe。

### nb-ui 的控件合同：`packages/nb-ui/src/components/form/`、`controls/`

统一表单控件的属性，作为 nb-ui 的规范写进 `ui-development-spec.md`：

```ts
modelValue / update:modelValue
disabled?: boolean
readonly?: boolean         // 可聚焦、可复制，不能改
// 从 FormField 上下文取（也接受同名属性）：id、aria-describedby、invalid、required
```

- 要改的控件：`Switch`、`SegmentedControl`（补 `disabled`）、`RadioGroup`、`CheckboxGroup`、`FormSelect`、`Combobox`、`TagInput`、`Slider`、`Listbox` 补 `readonly` 并接上 `FormField` 上下文；已经接上的 `FormInput`、`FormTextarea`、`FormNumberInput`、`FormCheckbox` 补 `invalid` 的外观。日期、颜色类控件本 Task 不动（表单第一版用不到），记为后续。
- 新增到 nb-ui 的基础控件：`SecretInput`（已设置／未设置、替换、清除；不显示值）、`FormNumberInput` 的 `unit`。
- 每个改动的控件同步改组件文档 `.md` 与 Lab 场景，补“只读”“出错”两种场景。

### 第一批使用方

- **设置**：`SettingsControl.vue` 删除，`SettingsRow` 的插槽默认放 `NbField`；通用列表的每一项照旧是 `SettingsRow`。行为与现在一致（开关、分段、下拉、数字、单行），数组、对象改成可编辑。设置的其余新能力（密钥、动态选项、搜索等）在 t02。
- **Lab**：`NbForm` 的场景覆盖每种字段、只读模式、问题显示、条件显示、对象数组的两种画法，以及“服务商连接”表单与 nbdev 四种题的样例。
- nbdev 与 Agent 不在本 Task 接入：nbdev 记在 w00022 的后续；Agent 随重建。本 Task 给出它们要的映射（见下）并用测试钉住。

### 给 nbdev 与 Agent 的映射

| 用途 | schema |
|---|---|
| nbdev 单选 | 字面量联合，`widget: "radio"`，`recommend` |
| nbdev 多选 | 字面量联合的数组（`uniqueItems`），`widget: "checkboxes"` |
| nbdev 文字 | 字符串，`widget: "multiline"` |
| nbdev 确认 | 布尔，`widget: "confirm"`（是／否） |
| Agent 提问 | Agent 给 JSON Schema（加可选布局），宿主先 `checkDescription(…, {policy: "agent"})`：不许密钥、不许自定义控件、限制嵌套深度与字段数 |
| 审批 | 动作参数的 schema，`mode: "readonly"`，同意／拒绝由宿主画 |

## Spec 与文档改动

- 新 Spec `docs/specs/ui/forms.md`（`ui.forms`，`planned`）：描述格式（JSON Schema 关键字、`x-form`、布局）、控件选择规则、校验与问题格式、条件显示、只读模式、动态选项、自定义控件、描述检查与 Agent 策略、TUI 退回规则（只到数据）。
- `packages/nb-ui/docs/ui-development-spec.md`：表单控件合同一节。
- `settings/settings-window.md` 输出 9：控件改由 `ui.forms` 选择；数组、对象改为可编辑（宽排法），去掉相应的 planned。
- 新包的 `AGENTS.md`、`README.md`；`docs/modules/monorepo-boundaries.md`、根 `AGENTS.md` 结构图登记新包。
- 组件文档：新组件与改动组件的同名 `.md`。

## 切片

| 片 | 内容 | 提交边界与自跑验证 |
|---|---|---|
| S0 | Spec `ui.forms`、新包骨架与登记 | `docs:check`、`governance:check` |
| S1 | 核心：描述、字段树、控件选择、校验与问题、条件、描述检查、退回 | 核心 `bun test`（表驱动，含 nbdev 四种题与“服务商连接”） |
| S2 | nb-ui 控件合同与新基础控件 | nb-ui 组件测试、Lab 截图（只读、出错） |
| S3 | Vue 渲染层：`NbForm`、`NbField`、外壳、结构控件、只读模式、动态选项、自定义控件 | Vitest、Lab 场景与截图 |
| S4 | 设置改用 `NbField`、删 `SettingsControl` | 设置的组件测试、`settings.e2e.ts` |

每片一个提交，在 Work 分支上做；S1 之后交 omp 审查核心，S3 之后交 Sonnet 审查界面，S4 之后再一轮。

## 验收映射

| Spec 条目（`ui.forms`，待写定编号） | 覆盖 |
|---|---|
| 描述格式、控件选择、自动布局 | 核心表驱动测试 |
| 校验与问题格式、跨字段校验 | 核心测试 |
| 条件显示（不执行代码） | 核心测试；源码里没有 `eval`、`new Function` 的检查 |
| 描述检查与 Agent 策略 | 核心测试（密钥、自定义控件、深度上限被拒） |
| 只读模式、动态选项、自定义控件、结构控件 | Vitest 组件测试 |
| 控件合同 | nb-ui 组件测试：每个控件的 `disabled`、`readonly`、`invalid`、标签与说明的关联 |
| 设置改用表单后行为不变 | 设置现有的组件测试与 `settings.e2e.ts` 照常通过 |

## 验证

- 每片自跑上表；完成后跑 nb-ui、nb-form、应用的测试与 typecheck，`docs:check`、`governance:check`，`settings.e2e.ts`（直接跑 Playwright 前先 `build`、`build:e2e`）。
- Lab 里截每种字段、只读模式、出错、条件显示、对象数组两种画法、“服务商连接”样例，看一致性与键盘、读屏（标签与错误的关联）。
- 留下的未验证边界：TUI 只到退回规则的数据，不画；生成式视图不做；外观收口在 t06。

## 不做与风险

- 不做：生成式视图；TUI 渲染层；nbdev 与 Agent 的接入；分步向导、日期时间、文件选择；字段间除“某字段满足某条件时显示”以外的联动；日期与颜色类控件的合同改造。
- 风险：
  - nb-ui 控件合同的改动波及现有使用方（设置、插件页、作品页、nbdev 面板），逐个控件改并跑全部组件测试；
  - `x-form` 是我们自己的扩展关键字，TypeBox 允许任意附加关键字，JSON Schema 校验器会忽略它；要防止它被当成数据合同的一部分（远程合同的 schema 里带着它不影响校验）；
  - 对象数组的“左列表右详情”在窄宽度下的排法，外观在 t06 定，本 Task 只保证能用。
