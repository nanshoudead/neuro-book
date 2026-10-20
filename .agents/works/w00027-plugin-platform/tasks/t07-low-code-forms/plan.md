# 实施计划：低代码（schema 表单与共用表单组件，t07）

2026-10-20 起草；同日按设计审查（omp 12 条、Sonnet 31 条，处理见文末）重写，再按 w00029（nb-ui 组件整理）已合入的改名与删除修订；开发者 2026-10-20 确认。

## Context

整个项目要用一套表单：设置（配置项、插件页面里的表单）、nbdev 的提问、Agent 向用户提问与审批、命令参数。现在各处各写各的：设置窗口有自己的 `SettingsControl`（按 schema 选控件，只会开关、选项、数字、单行文字，别的只读），nbdev 的四种题各有界面，Agent 还没重建；nb-ui 的表单控件写法不统一，组合控件（分段、单选组、复选组）放进 `Field` 拿不到可访问名称，`CheckboxGroup` 放进去还会出现重复 id 与嵌套 label（审查实测）。t02（设置补齐）要的多行、数组、对象、JSON、密钥、动态选项，也正是这套表单该有的。

与 w00029 的关系（开发者 2026-10-20 定）：
- w00029（nb-ui 组件整理）已合入的 t02、t03 删掉了 `Combobox`、`TagInput`、`Listbox` 等组件，并去掉了 `Form` 前缀（`Field`、`Input`、`Textarea`、`Select`、`Checkbox`、`NumberInput`），“标签、说明加控件”的整行容器统一叫 `…Field`；本计划用新名字，nb-form 的组件按同一规则命名（`SchemaForm`、`SchemaField`）。开工前先把 master 合进 Work 分支。
- 顺序：S0、S1 不碰 nb-ui，现在做；S2 起（改 nb-ui 与 Vue 渲染层）等 w00029 t04（弹出列表收成一套，改 `Select` 与共用列表样式、新增 `SuggestionMenu`）合入后再做；w00029 t05（nb-ui 规范文档整理）排在本 Task 的 S3 之后，届时把“表单控件合同”并进 nb-ui 规范。
- 按 `ui-development-spec.md` 4.5“同类零件的分工”：表单里选一个值用 `RadioGroup`（3 项以内横排）或 `Select`，`SegmentedControl` 只用来切换看法。设置窗口的短选项随之改用横排 `RadioGroup`，外观交给 t06。

依据：
- 开发者 2026-10-20 的决定，见 [README](README.md) 的“开发者已确认的决定”；另确认：核心自己写、建在 TypeBox 上，借用 JSON Forms 的概念不引入它的包；新包 `@notnotype/nb-form`；旧应用低代码的逐项处理。
- 调研：[`docs/research/low-code-forms.md`](../../../../../docs/research/low-code-forms.md)、[`docs/research/generative-ui-openui.md`](../../../../../docs/research/generative-ui-openui.md)。
- 设计审查报告：`evidences/design-review-omp.txt`、`evidences/design-review-sonnet.txt`。
- 规范：[`packages/nb-ui/docs/ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)（第 5 节表单、第 6 节交付）、[`docs/standards/code/components.md`](../../../../../docs/standards/code/components.md)、[`docs/testing/README.md`](../../../../../docs/testing/README.md) 的 UI 验收分档。

## 技术选型

自己写核心，建在 TypeBox 上；借用 JSON Forms 的三个概念（按“种类 + 提示”打分选控件、条件写成对另一个字段求值的 JSON Schema、没有布局时自动生成），不引入它的包。理由见调研：全项目校验已是 TypeBox；JSON Forms 要 AJV、Vue 绑定是预览版、控件要全部重写；Formily、vue-json-schema-form 的条件执行字符串代码；FormKit 不是 JSON Schema。旧应用也是在 TypeBox 上自己写的。（开发者已确认。）

## 旧应用的低代码

| 旧机制 | 新设计 |
|---|---|
| schema 之外另写 `fields` 列表，每项写明 `component` | 语义提示写在 schema 里、控件自动选，需要时 `widget` 指定；布局可选 |
| 选项提供者在服务端执行，收当前表单值，可以是 Promise | 选项由调用方提供（可以按表单值计算、可以异步），带加载中、不可用两种状态，见“选项” |
| 选项带 `disabled`、`description`；用 `typeof:value` 作键避免 `1` 与 `"1"` 撞键 | 保留，见“选项” |
| 当前值不在选项里时字段下给警告、保留原值 | 保留：显示该值并标“已不存在”（警告，不是错误），见“选项” |
| `issues` 带 `severity: error / warning` 与路径 | 保留，问题格式见“校验与问题” |
| 表单级 `validate` 钩子（可以是 Promise，只在类型通过后调用） | 核心只做同步的 schema 校验；跨字段、异步的校验由调用方算好问题交进来，过期结果由调用方按值的版本丢弃 |
| 作用域继承（项目“跟随全局 / 自定义”） | 不放进表单，归设置的 `SettingsRow` |
| `combobox`（在已有选项里搜索选择） | 保留：选项多或声明可搜索时用可搜索的下拉（nb-ui 的 `Combobox` 已在 w00029 删除，基于 t04 统一后的列表样式与浮层新做），见“控件对照” |
| `resource-preset`（选、建、改一份 Markdown 资源） | 不在第一版；Agent 重建时经自定义控件加回 |
| `defaults` 合并、控件显示默认值 | 表单不补默认值；默认值只显示，规则见“缺失与默认” |
| `LowCodeFieldShell`（标签、说明、错误外壳） | 保留，即“字段外壳” |

## 关键设计

### 包：`packages/nb-form`（新）

`@notnotype/nb-form`，`private: true`，两个入口：
- `.`（核心）：只依赖 `typebox`，不依赖 Vue，也不依赖应用包；
- `./vue`：依赖 `vue`、`@notnotype/nb-ui` 与核心。

登记：根 `package.json` 的 `workspaces`、使用方依赖（`@notnotype/neuro-book`；dev-panel 在 w00022 接入时加）、`docs/modules/monorepo-boundaries.md`、根 `AGENTS.md` 结构图、包内 `AGENTS.md` 与 `README.md`；把 `nb-form/src/vue/` 的组件目录加入 `docs:check` 的受管组件（同名 `.md` 必有）。测试：核心用 `bun test`，Vue 层用 Vitest（happy-dom），包的 `test` 脚本依次跑两者，`typecheck` 跑 `tsc` 与 `vue-tsc`。依赖边界加一条机检：`nb-form` 的 import 只允许 `typebox`、`vue`、`@notnotype/nb-ui` 与自身（保证将来能打进生成式视图的 iframe）。

### 描述格式与支持的写法：`src/description.ts`

数据是 TypeBox（标准 JSON Schema）。界面提示：

- JSON Schema 自带的关键字：`title`、`description`、`default`（只显示，见“缺失与默认”）、`readOnly`（只读，取父级与自身的最强）、`writeOnly`（密钥）、`format`、各种约束。
- 其余放在命名空间键 `x-form`（TypeBox 与远程合同、命令声明都接受它、校验时忽略，审查已实测）：

```ts
type FormText = string | Readonly<Record<string, string>>;   // 单语字符串，或按语言的文字（与应用的 LocalizedText 结构兼容）
interface FormHints {
    label?: FormText; help?: FormText; placeholder?: FormText; unit?: FormText;
    widget?: BuiltinWidget | string;      // 见“控件对照”；非内建名是自定义控件
    choices?: ReadonlyArray<{value: string | number | boolean; label: FormText; description?: FormText; disabled?: boolean}>;
    options?: string;                     // 动态选项源名
    searchable?: boolean;                 // 选项要能搜索
    visibleWhen?: {field: string; schema: object};
    itemLabel?: string;                   // 对象数组：当作项标题的字段名
    recommend?: ReadonlyArray<string | number | boolean>;   // 只作标记，必须在选项里
    rows?: number;
}
```

- 布局可选：`{type: "field", path} | {type: "column" | "row", items} | {type: "group", label, collapsed?, items}`；没给时按属性顺序排成一列。
- **支持矩阵**（写进 Spec，表驱动测试按真实 TypeBox 生成的形状写）：

| 写法 | 种类 |
|---|---|
| `boolean` | 布尔 |
| 字面量联合（`anyOf` 的 `const`，或 `enum`），值为字符串、数、布尔 | 单选 |
| 上面那种联合的数组（`uniqueItems`） | 多选 |
| `number`、`integer` | 数字 |
| `string` | 文字（`format` 只认 `uri`、`email`） |
| 字符串数组 | 字符串列表 |
| 有 `properties` 的对象 | 对象 |
| 元素是上一种对象的数组 | 对象列表 |
| `T` 与 `null` 的联合 | `T`，“清除”写 `null` |
| 其余：`Record`（`patternProperties`）、开放对象（`Type.Object({})`）、元组、其它联合、其它数组、`$ref` | JSON 编辑 |
| 超过深度上限（常量，6 层）的部分 | JSON 编辑 |

`checkDescription` 把一份描述分成“可结构化编辑 / 要用 JSON 编辑 / 不合格”三类，不合格时给出结构化的问题，从不抛异常。

### 路径、值与更新：`src/path.ts`、`src/value.ts`

- 内部路径是片段数组（字符串属性名、数组下标）；对外的编码是 RFC 6901 的 JSON Pointer（`~`、`/` 转义），由我们自己生成。不使用 TypeBox `instancePath` 当路径（它不转义，`"a/b"` 与 `a.b` 会撞，审查实测）。
- 值不可变：`setAt`、`removeAt` 写时复制，未改动的分支保留原引用；传入冻结的值也能用（设置的值是冻结的）。
- 可选属性的“清除”是删除这个键（不写 `undefined`、`0`、`""`）；数组项的删除是移除这一项。

### 缺失与默认

- 表单不补默认值。字段缺值时：文字与数字用占位文字显示“默认：X”（有 `default` 时）；选择类不预选，标题旁写“默认：X”；开关显示 `default` 的状态并标“默认”。
- 可选字段有值时，外壳给一个统一的“清除”动作（恢复未设置）；必填字段没有。
- `readOnly` 的字段，以及父级 `readOnly` 下的全部成员，在结构操作与 JSON 编辑里同样不能改。

### 校验与问题：`src/validate.ts`

```ts
interface FormIssue {
    path: ReadonlyArray<string | number>;
    code: string;                    // required、type、min-length、max-length、pattern、minimum、maximum、multiple-of、min-items、max-items、unique-items、not-in-choices、unparseable、schema-error，或调用方的码
    params: Readonly<Record<string, unknown>>;
    severity: "error" | "warning";
    source: "schema" | "caller";
    message?: FormText;              // 调用方的问题可以带文字；schema 的问题按 code 与 params 在显示时翻译
}
validateForm(model, value, {meta?}): FormIssue[]
```

- 不把 TypeBox 的错误直接换成问题：沿字段树逐个字段对自己的子 schema 校验，必填由我们按父对象的 `required` 展开到子字段，字面量联合只报一条 `not-in-choices`；最后对整值 `Value.Check` 兜底，归不到字段的错误记在根上。
- 任何 TypeBox 调用都包在 `try` 里，异常记为 `schema-error`，不穿透渲染。
- 调用方的问题（跨字段、异步、服务端）作为参数交给渲染层与外壳，与 schema 的问题合并显示；核心不调用调用方的函数。
- `meta`：按路径给带外状态（例如 `{"/apiKey": {secret: "set"}}`），`writeOnly` 的必填在密钥“已设置”时不报。

### 条件显示：`src/visible.ts`

- `visibleWhen.field` 指同一个对象里的兄弟字段（数组项里就是同一项的兄弟），以 `/` 开头时指根上的字段；用 `Value.Check` 对它的值检查那段 schema，不执行代码；引用的字段缺值时按 `undefined` 检查。
- 隐藏只影响显示：值保留，完整的 schema 照样校验。为了不出现“看不见的必填错误”，`checkDescription` 拒绝在必填字段上写 `visibleWhen`；按条件必填要用 schema 的分支约束表达。
- 显示与否不改值，所以条件之间不会互相触发。

### 选项

- 选项：`{value, label, description?, disabled?}`。控件里用稳定的键（`typeof` 加值，例如 `s:1`、`n:1`、`b:true`），出来时换回字面量；动态选项走同一处编码。
- 动态选项源：调用方给 `MaybeRefOrGetter<OptionSource>`，`OptionSource = {status: "ready"; items} | {status: "loading"} | {status: "unavailable"; reason: FormText}`；`unavailable` 时字段停用并显示原因。依赖别的字段的选项由调用方按表单值计算（源可以是 getter）。
- 当前值不在选项里：显示这个值并标“已不存在”（警告色调），保留原值，不算校验错误；源变化不改值。
- 3 项以内用横排的单选组，多于 3 项用下拉；多于 15 项或 `searchable` 时用可搜索的下拉。

### 控件对照

| 种类 / `widget` | nb-ui 控件 |
|---|---|
| 布尔（缺省） | `Switch` |
| 布尔，`confirm` | `RadioGroup`：是 / 否 |
| 单选：≤3 项 / 多于 3 项 / 多于 15 项或 `searchable` / `radio` | `RadioGroup`（横排）/ `Select` / 可搜索的下拉 `SearchSelect`（nb-ui 新增，见下）/ `RadioGroup`（竖排，可带说明） |
| 多选 | `CheckboxGroup` |
| 数字 | `NumberInput`，单位由外壳在旁边画 |
| 文字 / `multiline` / `writeOnly` 或 `secret` | `Input` / `Textarea` / `SecretInput` |
| 字符串列表 | nb-form 的 `StringList` |
| 对象 | nb-form 的 `ObjectFields`（可用 `group` 布局分组、折叠） |
| 对象列表 / `master-detail` | nb-form 的 `ObjectList` / `MasterDetail` |
| JSON（`json` 或兜底） | nb-form 的 `JsonEditor`（等宽文本框加解析与校验，不用 Monaco） |

`SegmentedControl` 不用于表单（只切换看法）；`Slider`、`ColorSwatches` 本 Task 不用、不改。

### nb-ui 的改动：`packages/nb-ui/src/components/`

先写“影响清单”：每个要改的控件，列出全仓库的调用方（应用、dev-panel、nb-story、llmlint、playground）与它们依赖的 DOM 契约，分成“不变”与“按设计变化”。

1. **`Field`**：上下文加 `labelId`；新增“组”形态（根是 `div`，标签是带 id 的元素，不是 `<label for>`），给分段、单选组、复选组用；导出 `useFieldContext`、上下文类型与键（现在没导出，跨包用不了）。
2. **组合控件的命名**：组合控件读 `labelId` 写 `aria-labelledby`，不再靠 `<label for>`。
3. **`Switch`**：去掉缺省的 `aria-label="开关"`（它会盖过字段标签）。
4. **`SegmentedControl`**：不进表单，本 Task 只修角色（根改为 `role="radiogroup"`、去掉 `aria-pressed`，审查 Sonnet 12）；空值时的 Tab 停靠点 w00029 t03 已修。**`RadioGroup`** 加横排（`orientation`），作为表单里 3 项以内的单选。
5. **`CheckboxGroup`**：组内的 `Checkbox` 不读字段上下文（现在会得到同一个 id、各自标红），上下文只用在组根。
6. **统一合同**（先写在 `ui.forms` 里，w00029 t05 重排 nb-ui 规范时并进第 5 节）：`modelValue` 可选、`undefined` 有安全显示；`disabled`；`readonly`；`invalid` 与 `aria-invalid`；标签、说明与问题的关联。要改的：`Switch`、`RadioGroup`、`CheckboxGroup`、`Checkbox`、`Select`；`Input`、`Textarea`、`NumberInput` 已有，只核对。
7. **只读语义逐个定义**（Reka 系与原生 checkbox 没有 readonly，要自己做）：保持可聚焦、写 `aria-readonly`；点击、空格、方向键不改值；下拉不打开浮层；标签输入不画删除与输入框；文字可选中。写成测试矩阵：控件 × {disabled, readonly}。
8. **`SearchSelect`**（新）：可搜索的下拉，用 t04 统一后的列表项样式、截断与滚动；输入的文字只是搜索词，只有选中选项才改值，失焦恢复显示已选项。
9. **`SecretInput`**（新）：通用的“可替换的敏感输入”，属性 `state: "set" | "unset" | "unreadable"`、`modelValue` 是新输入的值、事件 `clear`；不显示已有的值；`autocomplete="new-password"`；不含业务文案。
10. **可覆盖的读屏名称**：用到的控件里写死的中文名称（“增加”“减少”“清空输入”“展开选项”）改为可由属性覆盖，nb-form 按语言传入。
11. 交付按 nb-ui 共享基础组件的档位：四种组合（nbook / macos × 浅 / 深）加 390px 视口取证；样式变了重新生成并提交 `dist/nb-ui.css`；同名 `.md`、Lab 场景（`neuro-book` 的 `fixtures/nb-ui/`）、所有调用方同步。

### Vue 渲染层：`packages/nb-form/src/vue/`

```ts
<SchemaForm :schema :layout? v-model :mode? :readonly? :disabled? :issues? :meta? :options? :widgets? :locale :commit? :revision?
        @draft-state @focus-issue />          // expose: commit()、reset(path?)、focusFirstIssue()
<SchemaField :schema :hints? v-model :id? :bare? (同上的 mode、readonly、disabled、issues、meta、options、widgets、locale、commit、revision) />
widgetLayout(schema, hints?): {block: boolean; width: "narrow" | "medium" | "wide" | "content"}   // 外壳据此决定排法与宽度
```

- **模式**：`mode: "edit" | "view"`。`view` 是展示态（审批用）：文字类渲染成可换行的静态内容（超长折叠、可复制），不是一串只读输入框；“同意 / 拒绝”由调用方画。`readonly`、`disabled` 是独立的布尔，向下传递。
- **提交时机**：`commit: "change"`（缺省：文字、数字、JSON 在失焦或回车时发出，开关与选择类立即发出）或 `"input"`。文字、数字、JSON 控件内部持草稿；解析不了的草稿（`1.`、`-`、残缺的 JSON）不发 `update:modelValue`，以 `draft-state`（`{path, state: "clean" | "dirty" | "unparseable", issues}`）报告。外部的值或 `revision` 变化时，没有焦点的字段丢掉草稿、显示外部值（设置的“写入失败回到实际值”靠 `revision`）。
- **问题的显示**（遵守 nb-ui 规范“出错不在字段下插文字”）：字段只标红（`invalid`），第一条错误的文字经 `aria-describedby` 给读屏；警告不标红，用图标与色调。看得见的文字放在表单的固定位置：`SchemaForm` 底部一行问题汇总（“2 个问题”，点开列出、点一条聚焦到字段），调用方也可以关掉它、放到自己的固定位置（`@focus-issue`、`focusFirstIssue()`）。折叠的分组与列表项在头部标“含 N 个问题”。
- **条件显示**：用 `v-show` 加 `inert`，不卸载，草稿与折叠状态不丢。
- **列表编辑**（`StringList`、`ObjectList`、`MasterDetail`）：
  - 每项有稳定 id（与值并行维护；外部整体替换且与最近发出的值不同时重建），不用下标或值当 key；
  - 添加后焦点进新项的第一个控件；删除后焦点到下一项同类控件，没有就上一项，空了到“添加”；排序用“上移 / 下移”按钮与 `Alt+↑ / ↓`，焦点跟着那一项，读屏播报“第 3 项移到第 2 位”；
  - `minItems`、`maxItems` 到界时停用添加或删除；`uniqueItems` 的重复项标问题；空列表显示“还没有项”与“添加”；超过 50 项默认折叠成“N 项”、展开后分页；
  - `MasterDetail`：`v-model:selected`；新增项自动选中并聚焦详情；删除选中项后选下一项；列表项的选中区与操作按钮并列，不嵌套按钮；项标题取 `itemLabel` 字段，空时“第 N 项”。
- **自定义控件合同**：登记 `{name, component, score(node) => number | null, fallback}`；组件收 `{modelValue, node, readonly, disabled, invalid, id, describedby, locale, issues, options, meta}`，发 `update:modelValue`、`commit`，`expose({focus})`；显式 `widget` 直接选中；与内建名或已登记名重名时登记报错。Agent 策略不许自定义控件。
- **根元素**：`div role="group"`，不隐式提交；嵌在调用方的 `<form>` 里也合法。
- **深度**：渲染递归有上限（与核心同一常量）；折叠的分组、未选中的详情不挂载。
- **文字**：nb-form 自己的文案（添加、删除、上移、下移、第 N 项、N 项、已设置、未设置、清除、替换、已不存在、推荐、默认、是、否、问题汇总）是一张中英文字表，按 `locale` 取；`FormText` 的回退：所给语言 → `en-US` → 第一种。

### 给下游的接口

| 使用方 | 映射 | 本 Task |
|---|---|---|
| 设置 | 配置项声明经适配器转成 schema 与 `x-form`（`choices` → `x-form.choices`，t02 的 `choices.from` → `x-form.options`，提供者的 `title` → `label`，`secret` → `writeOnly`）；`SettingsRow` 里用 `SchemaField` 的 `bare` 形态，`widgetLayout` 决定宽排法与宽度（下拉 220、数字 120、单行 320、分段按内容、开关原样） | 接入（S5） |
| nbdev 单选 / 多选 / 文字 / 确认 | 字面量联合 + `radio`；字面量联合的数组 + `minItems: 1`；字符串 + `multiline` + `minLength: 1`、`maxLength: 10000`（去空白后非空、控制字符由 nbdev 的适配器以调用方问题报告）；布尔 + `confirm`，未答是缺值不是 `false`。`recommend` 只作徽标，不预选。每题的说明是适配器另加的可选多行字段，提交时拆成 `comments` | 只写进 Spec；接入在 w00022 |
| Agent 提问 | Agent 给 JSON Schema（可带布局），宿主先 `checkDescription(…, {policy: "agent"})` | 只做策略与检查 |
| 审批 | 动作参数的 schema，`mode: "view"`；“同意 / 拒绝”由宿主画 | 只做展示态 |
| 命令参数 | `args` 是关闭额外属性的对象 schema，直接用；必填未填时确认不可用；不补默认值 | 应用里加一条测试：所有已登记命令的 `args` 都能被 `checkDescription` 接受（不合格的列出） |
| 密钥（t02） | `writeOnly` + `SecretInput`；状态经 `meta` 传入，写入由设置的适配器做；值不进表单的值树 | 控件与 `meta`；存储在 t02 |

### Agent 策略：`checkDescription(…, {policy: "agent"})`

只接受一个可枚举的安全子集：根是对象；字段种类限于布尔、单选、多选、数字、文字（无 `pattern`、`patternProperties`，`format` 只认白名单）、字符串列表、一层嵌套对象、对象列表；不许 `writeOnly`、自定义控件、`$ref` / `$defs`；上限：节点 100、联合宽度 50、深度 3、描述 JSON 32 KB、每段文字 2000 字符。不合格给结构化问题，不抛异常。可信作者（插件、设置）写的 `pattern` 照常支持，求值异常记为 `schema-error`。

### 第一批使用方：设置

- 删除 `SettingsControl.vue`、`setting-controls.ts` 与它们的测试与 Lab 场景；选择规则的用例表迁到 nb-form 核心的控件选择测试（阈值 3、范围与步长取 schema 等判据保留）。
- `SettingsListSection` 用 `widgetLayout` 决定 `wide`；`SettingsRow` 的插槽里放 `SchemaField`（`bare`，`id` 与可访问名称由行给，`disabled` 由层状态与沿用给，`commit: "change"`，写入失败后 `revision` 加一）。
- 数组、对象从只读变为可编辑（宽排法）。`SettingsWindow.dom.test.ts` 里依赖 `data-settings-control` 与“readonly”项的断言按新行为改写，改用 nb-form 给的稳定标记 `data-nb-widget`，不加只为测试的钩子。

## Spec 与文档改动

- 新 Spec `docs/specs/ui/forms.md`（含表单控件合同，w00029 t05 时并进 nb-ui 规范）（`ui.forms`，`planned`）：描述格式与支持矩阵、控件选择与对照、路径与值、缺失与默认、校验与问题格式、条件显示、选项、提交时机与草稿、展示态、列表编辑、问题的显示、自定义控件合同、Agent 策略、给下游的映射、TUI 退回规则（只到数据）。
- `packages/nb-ui/docs/ui-development-spec.md`：本 Task 只改与本次改动直接相关的句子（第 5 节第 2 条的控件清单）；整节“表单控件合同”由 w00029 t05 从 `ui.forms` 并入。`Field.md` 的组形态与上下文消费者清单。
- `settings/settings-window.md` 输出 9：控件改由 `ui.forms` 选择（短选项从分段改为横排单选），数组、对象可编辑，去掉相应 planned；输出 14 的草稿语义写成引用 `ui.forms` 的提交时机。
- 新包与登记见“包”；新组件与改动组件的同名 `.md`。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 把 master 合进 Work 分支；Spec `ui.forms`（含控件合同）；新包骨架、登记、测试脚本、依赖机检、`docs:check` 受管目录 | 合并后应用与 nb-ui 测试；`docs:check`、`governance:check` |
| S1 | 核心：描述与支持矩阵、字段树、路径与值、控件选择、校验与问题、条件、选项编码、描述检查与 Agent 策略、退回规则 | 核心 `bun test`（真实 TypeBox 形状、路径撞名、必填展开、联合、坏正则与超限描述、冻结值） |
| S2a | （等 w00029 t04 合入、再合一次 master）nb-ui：影响清单；`Field` 组形态与导出；组合控件命名；`Switch`、`SegmentedControl`、`CheckboxGroup` 的修正 | nb-ui、dev-panel、nb-story 单测；Lab 用 Playwright 断言可访问名称 |
| S2b | nb-ui：统一合同与只读语义矩阵；`RadioGroup` 横排；`SearchSelect`；`SecretInput`；可覆盖的读屏名称；`dist/nb-ui.css` | 控件 × {disabled, readonly} 测试；四组合加 390px 取证；受影响的 e2e（nb-story `viewer`、`settings`、`bookshelf`、`lab*`） |
| S3a | nb-form/vue：外壳、`SchemaField`、标量控件、选项与“已不存在”、草稿与提交、展示态、问题汇总 | Vitest；Lab 场景 |
| S3b | 结构控件（`ObjectFields`、`StringList`、`ObjectList`、`MasterDetail`）、`JsonEditor`、自定义控件合同、条件显示的渲染 | Vitest（焦点落点、稳定 id、冻结值）；Lab 的 Playwright 键盘与可访问名称用例 |
| S4 | 应用里的命令参数检查测试；隔离测试（空文档、不 provide，挂每种字段） | 应用 `bun test`、Vitest |
| S5 | 设置改用 `SchemaField`、删 `SettingsControl` | 设置的组件测试、`settings.e2e.ts` |

每片一个提交，在 Work 分支上。审查：S1 后 omp（核心）；S2b 后 Sonnet（nb-ui）；S3b 后 Sonnet（渲染层）加 omp（接口）；S5 后一轮。

## 验收映射

| `ui.forms` 条目（写定编号后补） | 覆盖 |
|---|---|
| 支持矩阵、控件选择与对照、自动布局 | 核心表驱动测试（真实 TypeBox 生成的 schema） |
| 路径与值、缺失与清除、只读传递 | 核心测试（JSON Pointer 转义、撞名、冻结值、删除键） |
| 校验与问题格式、必填展开、联合、异常不穿透 | 核心测试 |
| 条件显示与“必填上不许条件” | 核心测试；渲染层测试（隐藏不丢草稿） |
| 选项编码、动态源三态、“已不存在” | 核心测试；渲染层测试 |
| Agent 策略与描述检查 | 核心测试（坏正则、超宽联合、`$ref`、超限、密钥、自定义控件） |
| 提交时机与草稿、`revision` 重置 | 渲染层测试；`SettingsWindow` 的 DOM 测试（写入失败回到实际值） |
| 展示态、问题汇总、列表编辑的焦点与键盘 | Vitest（`document.activeElement`）；Lab 的 Playwright 用例 |
| 控件合同、组合控件命名、只读语义 | nb-ui 测试矩阵；Lab 的 Playwright 可访问名称断言（`getByRole(…, {name})`、`toHaveAccessibleDescription`） |
| 能打包进 iframe 的前提 | 依赖机检；隔离测试 |
| 命令参数 | 应用测试：已登记命令的 `args` 全部可用 |
| 设置改用表单 | 设置的组件测试与 `settings.e2e.ts`（按新行为改写的断言逐条列出） |

## 验证

- 每片自跑上表；完成后跑 nb-ui、nb-form、dev-panel、nb-story、应用的测试与 typecheck，llmlint 网页做类型检查，`docs:check`、`governance:check`，受影响的 e2e（直接跑 Playwright 前先 `build`、`build:e2e`）。
- Lab 截图：每种字段、展示态、出错与警告、条件显示、列表两种画法、“服务商连接”样例、nbdev 四种题的样例；nb-ui 改动按四组合加 390px。
- 未验证的边界：TUI 只到退回规则的数据；生成式视图与 iframe 里的主题注入不做；外观收口在 t06。

## 不做与风险

- 不做：生成式视图；TUI 渲染层；nbdev、Agent、命令面板的接入；分步向导、日期时间、文件选择、颜色；字段间除条件显示外的联动；`Slider`、`Listbox`、日期与颜色类控件的合同改造；iframe 的构建与主题注入。
- 风险：
  - nb-ui 的改动面大（`Select` 全仓 15 个文件、`Input` 24 个），按影响清单逐个核对，“按设计变化”的断言显式改写；数字是 w00029 整理前的统计，S2a 开头重新统计；
  - 与 w00029 的先后：S2 起依赖 t04 合入；t05 排在 S3 之后，若 t05 先动了规范结构，S0 写在 `ui.forms` 里的控件合同照常有效，只是并入的位置变；
  - 片数多（8 片），S2、S3 是重头；若要更早给 t02 用，可以在 S3a 之后先做 S5（设置只用标量控件），结构控件随后补；
  - `x-form` 是自定义关键字，校验器忽略它（已实测），但它会跟着 schema 进远程合同，只是多带了数据。

## 设计审查的处理（2026-10-20）

两份报告各自核实后都成立（omp 12 条：重要 11、建议 1；Sonnet 31 条：阻断 1、重要 23、建议 7）。归并后的处理，对应到上文：

- 可访问性与 nb-ui（Sonnet 1、2、3、4、6、7、12、23、24、29、30）：见“nb-ui 的改动”第 1–11 条与 S2a、S2b 的验证。
- 密钥（omp 1、Sonnet 18）：`SecretInput` 通用化、状态经 `meta`、写入归 t02 的适配器，见“nb-ui 的改动”第 9 条与“给下游的接口”。
- Agent 策略与坏 schema（omp 2）：见“Agent 策略”。
- 错误路径与问题格式（omp 3、Sonnet 9）：见“路径、值与更新”“校验与问题”“问题的显示”。
- 条件显示（omp 4、Sonnet 27）：见“条件显示”与渲染层的 `v-show` 加 `inert`。
- 草稿与提交（omp 5、Sonnet 10）：见“提交时机”。
- nbdev 映射（omp 6、Sonnet 31 第 4 点）：见“给下游的接口”。
- 选项（omp 7、Sonnet 5、15、20、26）：见“选项”“控件对照”与 `SearchSelect`（`Combobox` 已在 w00029 删除）。
- 支持矩阵与递归（omp 8、Sonnet 31 第 2 点）：见“描述格式与支持的写法”。
- 缺失值与只读（omp 9、Sonnet 6、22）：见“缺失与默认”、展示态。
- 异步校验（omp 10）：见“旧应用的低代码”表与“校验与问题”。
- 文字与本地化（omp 11、Sonnet 21）：见 `FormText` 与渲染层“文字”。
- 搜索选择（omp 12）：见“控件对照”。
- 设置接入（Sonnet 8、11、19）：见“第一批使用方：设置”“给下游的接口”。
- 列表编辑（Sonnet 13、14）：见“列表编辑”。
- 控件清单（Sonnet 16）：见“控件对照”；`Listbox`、`TagInput` 已在 w00029 删除，`Slider` 移出范围。
- iframe 前提（Sonnet 17）：收窄为依赖机检与隔离测试，主题注入记为后续。
- 自定义控件（Sonnet 25）、命令参数（Sonnet 28）、根元素与单位与推荐（Sonnet 31）：见渲染层与“给下游的接口”。
