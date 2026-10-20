# 调研：schema 驱动表单与受约束的生成式界面

日期：2026-10-20

## 问题

NeuroBook 想做一套全项目共用的“低代码”表单描述，用于：应用设置（含对象数组与密钥项）、Agent 提问与操作审批（同一份表单可能显示成只读加同意／拒绝）、开发者面板 nbdev 的提问（单选、多选、文字、确认）、插件命令参数。以后可能在终端界面（TUI）里复用同一份描述；还考虑让 LLM 生成表单（输出 JSON 描述，或直接写 TSX）。本文记录现成方案的事实，供 ADR／Proposal 取舍时引用。本文不含推荐结论。

项目既有条件（仅作对照基准）：Vue 3 + Vite；自有组件库 nb-ui（基于 reka-ui）；校验用 TypeBox（生成标准 JSON Schema）。

## 证据等级与验证边界

- 官方文档：用 WebFetch 读取官方站点或仓库 README 得到的内容。WebFetch 返回的是小模型对页面的摘要，不是页面原文；凡标“原文”的引文，均来自仓库里的 Markdown 原文或 npm 包文件。
- 源码：读取官方仓库（raw.githubusercontent.com）或 npm 包里的文件。
- 检索：`npm view`、`gh api` 查到的版本、许可证、发布日期、星数、提交时间（2026-10-20 当天查询）。
- 实测：本调研没有安装或运行任何库。各节“服务商连接”示例是按官方文档的语法写出的，没有执行过，标注“示例未运行”。
- 星数、推送时间是 2026-10-20 当天的值。“最近发布”优先取 GitHub release，npm 的 `time.modified` 单列。npm 的 `unpackedSize` 是解压后的包体大小，不是打包后的运行时体积（没有测 bundle）。
- 未查到的信息在各节“未查到”处明说。

## 对照用的示例：“服务商连接”表单

各节用同一个表单：ID 只读；名称；API Base；接口格式二选一；API Key（密钥）；超时与重试两项并排；扩展参数 JSON；选了某个接口格式才显示的代理字段。下面是共用的数据 schema（标准 JSON Schema，各库若需要自己的写法会在节内另写）：

```json
{
  "type": "object",
  "required": ["name", "apiBase", "apiFormat", "apiKey"],
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string", "minLength": 1 },
    "apiBase": { "type": "string", "format": "uri" },
    "apiFormat": { "type": "string", "enum": ["openai", "anthropic"] },
    "apiKey": { "type": "string" },
    "timeoutMs": { "type": "integer", "minimum": 0 },
    "retries": { "type": "integer", "minimum": 0 },
    "extra": { "type": "object" },
    "proxy": { "type": "string" }
  }
}
```

示例里“选了 `openai` 才显示 proxy”只是为了演示条件显示的写法，不代表产品需求。

# 一、schema 表单类

## 1. JSON Forms（eclipsesource）

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 包 | `@jsonforms/core`、`@jsonforms/vue`、`@jsonforms/vue-vanilla`（同一版本号） |
| npm 最新版 | 3.8.0（`next` 标签 3.9.0-alpha.1）；npm `time.modified` 2026-08-06 |
| GitHub release | v3.8.0，2026-06-16 |
| 许可证 | MIT |
| 仓库 | github.com/eclipsesource/jsonforms，2748 星，最近推送 2026-10-19，未归档 |
| 包体（解压后） | core 1.17 MB、vue 251 KB、vue-vanilla 647 KB |
| 依赖 | core：`ajv ^8.18.0`、`ajv-formats ^2.1.1`、`lodash`、`@types/json-schema`；vue：peer `vue ^3.5.0` 与 `@jsonforms/core` 同版本 |

Vue 支持（官方文档 `jsonforms.io/docs/integrations/vue`）：该集成页写明“Currently this integration is in a preview state”（摘要）。Vue 3 通过 `@jsonforms/vue` 支持；Vue 2 的 `@jsonforms/vue2` 在 3.2 起移除，最后支持版本为 3.1.0。官方渲染器集有两套：`@jsonforms/vue-vanilla`（HTML5）与 `@jsonforms/vue-vuetify`（也标 preview）。

### 描述写法

数据 schema 与界面描述分开：JSON Schema 描述数据，UI schema 描述布局，用 `scope`（JSON Pointer，如 `#/properties/name`）把控件绑到数据属性。`schema`、`uischema` 都是可选 prop，缺省时自动生成（README 原文：“Will be generated when not given.”）。

UI schema 元素类型（官方文档“layouts”页）：`Control`；布局 `VerticalLayout`、`HorizontalLayout`、`Group`（要求 `label`）、`Categorization`（只能包含 `Category`）；另有 `Label`（i18n 文档提到）。规则写在元素的 `rule` 里：`effect` 取 `HIDE | SHOW | ENABLE | DISABLE`，`condition` 的 `SchemaBasedCondition` 为 `{scope, schema, failWhenUndefined?}`，其中 `schema` 是标准 JSON Schema，对 `scope` 处的数据校验。该页只记了这一种条件；条件组合（`OR`、`AND`、`LeafCondition`）本次未在文档页核实。

示例（按官方语法写，示例未运行；数据 schema 见开头）：

```json
{
  "type": "VerticalLayout",
  "elements": [
    { "type": "Control", "scope": "#/properties/id", "options": { "readonly": true } },
    { "type": "Control", "scope": "#/properties/name", "label": "名称" },
    { "type": "Control", "scope": "#/properties/apiBase" },
    { "type": "Control", "scope": "#/properties/apiFormat", "options": { "format": "radio" } },
    { "type": "Control", "scope": "#/properties/apiKey" },
    {
      "type": "HorizontalLayout",
      "elements": [
        { "type": "Control", "scope": "#/properties/timeoutMs" },
        { "type": "Control", "scope": "#/properties/retries" }
      ]
    },
    { "type": "Control", "scope": "#/properties/extra" },
    {
      "type": "Control",
      "scope": "#/properties/proxy",
      "rule": {
        "effect": "SHOW",
        "condition": { "scope": "#/properties/apiFormat", "schema": { "const": "openai" } }
      }
    }
  ]
}
```

Control 的 `options`（官方“controls”页）：`readonly`（用在布局上则整个布局只读）、`format: 'radio'`（枚举显示为单选组）、数组控件的 `detail`（`DEFAULT | GENERATED | REGISTERED | 内联 UI schema`）、`showSortButtons`、`elementLabelProp`。`label` 可设为 `false` 隐藏标签。

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象 | vue-vanilla 带 `ObjectRenderer`（源码目录 `src/complex/`）；UI schema 可嵌套布局 |
| 对象数组增删排序 | vue-vanilla 带 `ArrayListRenderer`；`options.showSortButtons` 开启排序按钮（官方文档“controls”页） |
| 条件显示 | UI schema 的 `rule`，条件是 JSON Schema（见上） |
| 字段联动（改值、改选项） | 官方文档页未见声明式联动；rule 只有显示／启用四种 effect。联动值与选项需自写（如自定义 renderer 或 middleware）——后一点来自 Vue README 列出的 `middleware` prop，具体用法未核实 |
| 动态选项（异步） | 本次未查到官方说法 |
| 校验与错误显示 | 内置 AJV（默认 `allErrors: true, verbose: true, strict: false`，加 `ajv-formats`）；`validationMode` 取 `ValidateAndShow`（默认）、`ValidateAndHide`、`NoValidation`；`additionalErrors` 可注入外部（如后端）错误；可传自有 `ajv` 实例（官方“validation”页） |
| 只读展示 | 根组件 `readonly` prop；`options.readonly`；rule 的 `DISABLE` |
| 国际化 | `i18n` prop 含 `locale`、`translate`、`translateError`；键来自 UI schema 的 `i18n`、JSON schema 的 `i18n`、属性路径；错误键查找顺序为 `<key>.error.custom`、`<key>.error.<keyword>`、`error.<keyword>`、错误自带 message、AJV 默认。官方 i18n 页注明内置渲染器集尚不可翻译（摘要）；vue-vanilla 源码里仅 `ArrayListRenderer`、`OneOfRenderer` 读取 `translate` |
| 自定义控件登记 | 渲染器登记项 `{ renderer, tester }`，如 `tester: rankWith(1, isControl)`（Vue README 原文）；`rankWith`、`scopeEndsWith`、`isControl` 等来自 `@jsonforms/core`；同一数据位置命中多个 tester 时按 rank 取高者。Vue 里用 `rendererProps()` + `useJsonFormsControl(props)`，得到 `control`（`data`、`errors`、`enabled` 等）与 `handleChange(path, value)` |
| 与 TypeBox 的 JSON Schema | JSON Schema 直接作为输入（标准 schema + AJV 校验）。TypeBox 生成的是标准 JSON Schema，但其自有关键字（如 `[Kind]` 符号属性、`Type.Transform`）不进 JSON 序列化；本次未实测 |
| 密钥控件 | vue-vanilla 的 controls 目录只有 Boolean、Date、DateTime、Enum、EnumOneOf、Integer、MultiString、Number、String、Time（源码）；没有 password 控件，需自写 renderer |
| 对象类型的自由 JSON 字段 | vue-vanilla 的 `ObjectRenderer` 针对有 `properties` 的对象；对无 `properties` 的 `{type:"object"}` 的默认表现本次未实测 |

### 换成自有组件库

Vue README 说明：`@jsonforms/vue` 提供基于组合式 API 的绑定，“it's straightforward to create renderer sets for Vue 3”。renderer 集是一个 `{renderer, tester}` 数组，所以换成 nb-ui 就是自写一套 renderer 集，替换 `vue-vanilla`。vue-vanilla 的 `renderers.ts` 列出其需要覆盖的类别：控件（见上）、布局（`LayoutRenderer`、`GroupRenderer`、`CategorizationRenderer`、`CategorizationStepperRenderer`）、复杂类型（`ObjectRenderer`、`OneOfRenderer`、`EnumArrayRenderer`）、数组（`ArrayListRenderer`）、`label`。vue-vanilla 允许通过 `provide` 注入 `styles` 替换 CSS 类名（README），这是不写 renderer 只换样式的路径。

### 非浏览器复用

`@jsonforms/core` 的依赖里没有 React／Vue／DOM 框架（`ajv`、`ajv-formats`、`lodash`、`@types/json-schema`，见 `package.json`）。官方另有 React、Angular 绑定（官方站点），说明 core 与 UI 框架解耦。官方没有终端渲染器；core 在 Node／Bun 里能否直接用本次未实测。

### 未查到

条件组合（`OR`／`AND`）的文档页；异步选项的官方做法；自定义 renderer 在 Vue 里的完整官方教程页（`tutorial/custom-renderers` 页只讲 React，Vue 的写法来自 `packages/vue/README.md`）。

## 2. FormKit

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 包 | `@formkit/core`、`@formkit/vue`（另有 `@formkit/react`、`@formkit/zod`、`@formkit/i18n`、`@formkit/rules`、`@formkit/validation` 等，见仓库 `packages/`） |
| npm 最新版 | 2.1.2；npm 与 GitHub release 均为 2026-07-24 |
| 许可证 | 核心 MIT（npm 元数据）；`@formkit/pro` 的许可为 “SEE LICENSE IN LICENSE.md”（npm 0.130.0，2026-06-10） |
| 仓库 | github.com/formkit/formkit，4778 星，最近推送 2026-07-24 |
| 包体（解压后） | core 1.07 MB、vue 1.98 MB |
| 依赖 | `@formkit/core` 只依赖 `@formkit/utils`；`@formkit/vue` peer `vue ^3.4.0` |

收费部分（官方 `formkit.com/pro`，摘要）：FormKit Pro 是付费附加包，含 14 个高级输入（Autocomplete、Colorpicker、Currency、Datepicker、Dropdown、Mask、Rating、Repeater、Slider、Taglist、Toggle、Toggle Buttons、Transfer List、Unit）。价格页写 Production 一次性 149 美元、Enterprise 起价 1250 美元。该页把 Repeater、Toggle、Toggle Buttons 标为 “Free”，但没有解释含义；repeater 页标题同时带 “Free Pro” 字样。Pro 在 localhost 与开发域名无需 key；Pro 包会发送域名和所用 Pro 输入名的遥测（Enterprise 可关）。password 输入页在侧栏无 Pro 标记（摘要判断，页面没有直接写“免费”）。

### 描述写法

FormKit 的 schema **不是 JSON Schema**。官方文档（schema 页，摘要）称其为 “a JSON-serializable data format for storing DOM structures and component implementations”：节点数组，节点类型有字符串、`$el`（HTML 元素，含 `attrs`、`children`）、`$cmp`（组件，含 `props`，组件须全局注册或经 `library` 传入）、`$formkit`（输入的简写，属性与 `$formkit` 并列）。表达式是 FormKit 自己的受限语言：`$变量`、`$:` 起头的表达式、`if`／`then`／`else`、`for: ['item','key','$cities']`、`bind`、`$get(id)`（读另一个有显式 `id` 的输入的 context）。数据 schema 与界面描述没有分开：校验写在节点的 `validation` 字符串里（如 `required|email`）。

示例（按官方语法写，示例未运行；`if` 里用 `$get` 的写法依据文档“`$get(id)` 读取另一个输入 context”一句，具体表达式未核实）：

```js
const schema = [
  { $formkit: 'text', name: 'id', label: 'ID', disabled: true },
  { $formkit: 'text', name: 'name', label: '名称', validation: 'required' },
  { $formkit: 'url', name: 'apiBase', label: 'API Base', validation: 'required' },
  { $formkit: 'radio', id: 'fmt', name: 'apiFormat', label: '接口格式',
    options: ['openai', 'anthropic'], validation: 'required' },
  { $formkit: 'password', name: 'apiKey', label: 'API Key', validation: 'required' },
  { $el: 'div', attrs: { class: 'row' }, children: [
    { $formkit: 'number', name: 'timeoutMs', label: '超时', validation: 'min:0' },
    { $formkit: 'number', name: 'retries', label: '重试', validation: 'min:0' },
  ] },
  // 扩展参数 JSON：无内置输入，需 createInput 自定义后按 type 引用
  { $formkit: 'text', name: 'proxy', label: '代理',
    if: '$get(fmt).value === "openai"' },
]
```

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象 | 官方有 `group` 类型输入（validation 页提到 form／group／list；group 的写法本次未逐页核实） |
| 对象数组增删排序 | `repeater`：默认带 Add、remove、上移下移控件，`min` 默认 1、`max` 默认无限，schema 写法 `{ $formkit: 'repeater', name, children: [...] }`（官方 repeater 页）。该页标题带 Free／Pro 标签，授权归属以官方说明为准，本次未能确认 |
| 条件显示 | 节点 `if`；`if/then/else` 可用于节点、子列表、`attrs`、`props` |
| 字段联动 | 表达式引用 `$get(id)`、`$变量`；没有声明式“联动协议” |
| 动态选项（异步） | select 页只列四种来源：字符串数组、值标签对象、`{label,value}` 数组、`<option>` 插槽；页面没有函数／Promise 说法 |
| 校验与错误显示 | 30 多条内置规则，管道字符串或数组语法；`validationVisibility` 取 `blur`（默认）、`live`、`dirty`、`submit`；自定义规则是 `(node) => boolean`，全局注册在 config 的 `rules` 或经 `validationRules` 传入。另有 `@formkit/zod` 包（本次未读其文档） |
| 只读展示 | 没有专门只读模式；password 页的 props 表无 `disabled`，Accessibility 节把 `disabled` 列为 `input` 区段属性。form 级 `disabled` 本次未查到 |
| 国际化 | `@formkit/i18n`，官方称提供 47 个 locale；消息在 locale 的 `ui` 与 `validation` 下，可在 config 的 `messages` 覆盖 |
| 自定义控件登记 | 三种：给 `<FormKit>` 的 `type` 直接传定义；`defaultConfig.inputs` 全局登记；plugin 的 `library` 函数。`createInput(组件或 schema 节点, 定义属性, sectionsSchema)` 生成定义，自动带 label、help、validation。官方页的示例是 React；页面说“Schema inputs are the most portable option across FormKit's supported frameworks, including Vue and React”。“在 JSON schema 里直接引用自定义输入类型”官方页未给示例 |
| 与 TypeBox 的 JSON Schema | 不能直接用；FormKit schema 不是 JSON Schema。`@formkit/zod` 针对 Zod，本次未查是否支持 JSON Schema |

### 换成自有组件库

输入的外观由“sections schema”决定，可用 `createInput` 把自有组件包成输入（官方 custom-inputs 页）。要覆盖的是 text、number、select、radio、checkbox、password、url 等各 `type`，以及 `form`、`group`、`list`、`repeater` 的包装。

### 非浏览器复用

`@formkit/core` 只依赖 `@formkit/utils`（npm 元数据），不依赖 Vue。官方文档页没有声明 core 可脱离 DOM 使用；`@formkit/vue` 与 `@formkit/react` 同时存在，说明有跨框架绑定。无终端渲染器。

### 未查到

form 级禁用的文档；group／list 的 schema 写法；`@formkit/zod` 的能力；Repeater 的授权归属的明确说法；core 在无 DOM 环境的可用性。

## 3. Formily（阿里）

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 包 | `@formily/core`、`@formily/vue`、`@formily/json-schema`、`@formily/reactive`、`@formily/validator`，Vue 组件库 `@formily/element-plus` |
| npm 最新版 | 2.3.7（`@formily/core`、`@formily/vue` 同），npm `time.modified` 2025-05-15；GitHub 最新 release 为 v2.3.6，2025-05-15 |
| 许可证 | MIT |
| 仓库 | github.com/alibaba/formily，12588 星，默认分支 `formily_next`，最近推送 2025-06-21（一条回滚提交），未归档 |
| 包体（解压后） | core 1.53 MB、vue 634 KB |
| 依赖 | `@formily/vue` peer `vue ^2.6.0 || >=3.0.0-rc.0`，依赖 `vue-demi`；`@formily/json-schema` 依赖 core、reactive、shared |
| Vue 3 UI 库 | `@formily/element-plus` 1.1.0，npm `time.modified` 2024-07-05，peer `vue ^3.2.24`。`@formily/ant-design-vue`、`@formily/naive-ui` 在 npm 上查不到（404） |

维护信号：最近一次发布与 npm 修改均为 2025-05；最近一次推送为 2025-06-21；GitHub 上 2026-08、2026-09 仍有新开的 issue／PR（标题形如 `fix(grid): ...`，是否合并未核实）。仓库没有声明停止维护。

### 描述写法

Formily 的 JSON Schema 是“扩展了 `x-*` 关键字的 JSON Schema”：数据类型与界面写在同一个 schema 节点里（`type`、`enum` 与 `x-component`、`x-decorator`、`x-pattern`、`x-display`、`x-validator`、`x-reactions`、`x-visible`；仓库 `packages/vue/docs/api/shared/schema.md`）。`x-component`、`x-decorator` 的字符串要和 `createSchemaField({ components, scope })` 传入的组件表的键匹配。`SchemaField` 的 props 为 `schema`、`scope`、`name`。

联动协议 `x-reactions`（同上文档）：`dependencies`（依赖字段路径）、`when`、`target`（主动联动要操作的字段，不支持相对路径）、`fulfill`／`otherwise`（`state`、`schema`、`run`），表达式用 `{{...}}`；也可传函数。文档里的原文示例：

```json
"x-reactions": {
  "target": "target",
  "when": "{{$self.value === '123'}}",
  "fulfill": { "state": { "visible": false } },
  "otherwise": { "state": { "visible": true } }
}
```

示例（按官方 schema 语法写，示例未运行；`Input`、`Select`、`Password`、`NumberPicker`、`FormGrid`、`FormItem` 是否存在取决于所选 UI 组件库，需和 `createSchemaField` 传入的 components 对应）：

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "title": "ID", "x-decorator": "FormItem", "x-component": "Input", "x-pattern": "readOnly" },
    "name": { "type": "string", "title": "名称", "required": true, "x-decorator": "FormItem", "x-component": "Input" },
    "apiBase": { "type": "string", "title": "API Base", "x-decorator": "FormItem", "x-component": "Input", "x-validator": "url" },
    "apiFormat": {
      "type": "string", "title": "接口格式", "enum": ["openai", "anthropic"],
      "x-decorator": "FormItem", "x-component": "Select",
      "x-reactions": {
        "target": "proxy",
        "fulfill": { "state": { "visible": "{{$self.value === 'openai'}}" } }
      }
    },
    "apiKey": { "type": "string", "title": "API Key", "x-decorator": "FormItem", "x-component": "Password" },
    "row": {
      "type": "void", "x-component": "FormGrid", "x-component-props": { "maxColumns": 2 },
      "properties": {
        "timeoutMs": { "type": "number", "title": "超时", "x-decorator": "FormItem", "x-component": "NumberPicker" },
        "retries": { "type": "number", "title": "重试", "x-decorator": "FormItem", "x-component": "NumberPicker" }
      }
    },
    "proxy": { "type": "string", "title": "代理", "x-decorator": "FormItem", "x-component": "Input" }
  }
}
```

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象 | `type: "object"` + `properties`；`type: "void"` 用于不产生数据的布局节点 |
| 对象数组增删排序 | `type: "array"` + `items`，由 UI 库的数组组件（如 `ArrayTable`，文档示例出现 `"x-component": "ArrayTable"`）承担；`@formily/element-plus` 依赖 `vuedraggable`、`vue-slicksort`，即排序由其数组组件实现（依赖推断，未读组件文档） |
| 条件显示 | `x-reactions` 改 `state.visible`；或 `x-visible`、`x-display`（`none`／`hidden`／`visible`） |
| 字段联动 | `x-reactions` 主动联动（有 `target`）与被动联动（无 `target`），可改 state 或 schema 或执行语句；支持 10 种生命周期 effect（`onFieldInit`、`onFieldValueChange` 等） |
| 动态选项（异步） | `enum` 与 `x-reactions` 的 `fulfill.schema`／`state.dataSource` 可更新选项；异步加载靠作用域里的函数。具体异步示例本次未查 |
| 校验与错误显示 | `@formily/validator`，字段 `x-validator`；支持内置格式名与自定义规则（详细规则列表本次未查） |
| 只读展示 | `x-pattern`：`editable`、`readOnly`、`disabled`、`readPretty`（`@formily/core` 类型定义 `FieldPatternTypes`）；`readPretty` 是专门的“阅读态”渲染，由组件库各自实现 |
| 国际化 | 本次未查到官方说明 |
| 自定义控件登记 | `createSchemaField({ components: { 键: 组件 }, scope })`，Vue 组件用 `@formily/vue` 的 `connect`／`mapProps`／`mapReadPretty` 一类桥接（API 名来自 Formily 官方概念，Vue 文档页本次未逐一核实） |
| 与 TypeBox 的 JSON Schema | 标准关键字（`type`、`enum`、`properties`、`required` 等）可读取；是否对所有标准关键字生效（如 `minLength` 是否自动变校验）本次未核实；界面部分必须另加 `x-*` |
| 表达式执行 | 读 npm 包 `@formily/json-schema@2.3.7` 的 `lib/compiler.js`：`{{...}}` 表达式用 `new Function('$root', "with($root) { return (...); }")` 执行（源码）。因此 schema 里的表达式字符串是可执行代码 |

### 换成自有组件库

需要自己准备 `FormItem`（装饰器）和各输入组件，并用 `connect` 一类桥接接入 Formily 字段模型；布局、数组组件（增删排序）也要自备，`@formily/element-plus` 是现成的参照实现，其依赖是 `element-plus`。

### 非浏览器复用

`@formily/core` 的依赖只有 `@formily/reactive`、`@formily/shared`、`@formily/validator`，没有 Vue／React；`@formily/json-schema` 依赖 core、reactive、shared（npm 元数据）。React 与 Vue 绑定另成包，这是官方的解耦方式。官方没有终端渲染器；core 在无 DOM 环境运行本次未实测。

### 未查到

Vue 3 + Formily 的官方入门页（`vue.formilyjs.org/guide/quick-start` 返回 404）；国际化；异步选项示例；上述 `mapProps` 等 Vue API 细节。

## 4. vue-json-schema-form（`@lljj/vue3-form-*`）

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 包 | `@lljj/vue3-form-core`、`@lljj/vue3-form-element`（Element Plus）、`@lljj/vue3-form-ant`、`@lljj/vue3-form-naive`（Vue 2 另有一批包） |
| npm 版本 | core、element、ant 均 1.19.0（2023-10-05）；naive 1.19.1（2023-10-05）。注意 `@lljj/vue3-form-ant-design` 不存在（404），实际包名是 `-ant` |
| GitHub release | v1.19.0，2023-10-05 |
| 许可证 | Apache-2.0 |
| 仓库 | github.com/lljj-x/vue-json-schema-form，2267 星；最近推送 2026-05-20（改 README），上一次提交 2025-08-05（demo 文件），未归档 |
| 包体（解压后） | core 113 KB、element 1.28 MB |
| 依赖 | core 依赖 `@lljj/vjsf-utils` 1.19.0 |

维护信号：最近一次发布 2023-10；之后的提交为 demo 与 README 修改（仓库提交记录，检索）。

### 描述写法

数据 schema 就是 JSON Schema，界面描述既可以放在独立的 `uiSchema` 里，也可以直接放在 schema 节点上，键用 `ui:` 前缀（README 的示例把 `'ui:options'` 写在 `bio` 属性里）。读 `@lljj/vjsf-utils@1.19.0` 源码可见的键有：`ui:widget`、`ui:hidden`、`ui:options`、`ui:field`、`ui:fieldProps`、`ui:order`、`ui:required`、`ui:showTitle`、`ui:showDescription`（源码）。`ui:hidden` 可以是函数或表达式字符串，`ui:` 开头的选项值若为表达式字符串，经 `new Function('parentFormData', 'rootFormData', 'return ' + code)` 执行（`formUtils.js`，源码），因此条件显示靠可执行表达式，不是声明式条件。

README 示例（原文，Element Plus 版）：

```js
schema: {
  type: 'object',
  required: ['userName', 'age'],
  properties: {
    userName: { type: 'string', title: '用户名', default: 'Liu.Jun' },
    bio: { type: 'string', title: '签名', minLength: 10,
      'ui:options': { placeholder: '请输入你的签名', type: 'textarea', rows: 1 } }
  }
}
```

“服务商连接”示例：官方文档站（`vue-json-schema-form.lljj.me`）本次抓取因证书错误无法读取，README 之外的写法没有核实，因此不贴示例，只列依据源码能确认的键：只读（`ui:options` 里传 `readonly` 给 widget，具体键名未核实）、条件显示（`ui:hidden` 表达式）、并排（本次未查到布局写法）。

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象、数组 | README 声称“遵循 JSON Schema 规范”；数组控件增删排序的细节未查到 |
| 条件显示 | `ui:hidden` 表达式；官方“标准 JSON Schema 不支持部分”页（`guide/todo.html`）抓取失败，`if/then/else`、`dependencies` 支持情况未核实。源码里可见对 `oneOf`／`anyOf` 的处理 |
| 校验 | 使用 ajv（README）；`schema/validate.js` 在 core 里 |
| 国际化 | `@lljj/vjsf-utils` 有 `i18n` 目录（含 `localize`，源码） |
| 自定义控件 | `ui:widget`、`ui:field` 可传已注册名或 Vue 组件（`getUiField` 源码） |
| 与 TypeBox 的 JSON Schema | 输入就是 JSON Schema，ajv 校验；未实测 |
| 其他 | README 称设计与 schema 解析参考了 RJSF；另有可视化 schema 生成器 |

### 换成自有组件库

官方已有 Element Plus、Ant Design Vue、Naive UI 三套适配（README），均基于 `@lljj/vue3-form-core`（"通过 core 适配 ElementPlus 库"）。换成自有库就是仿照这三个包新写一个适配包；适配包需要覆盖的 widget 清单本次未读源码。

### 非浏览器复用

`@lljj/vue3-form-core` 依赖 `@lljj/vjsf-utils`，utils 里含 Vue 组件与样式（包内有 `components`、`style`、`vue3Utils.js`），不是纯逻辑包。无终端渲染器。

### 未查到

官方文档站内容（证书错误）；数组、布局、联动的官方写法；其与 Vue 3.5 的兼容性。

## 5. vue-form-json-schema

| 项 | 值 |
| --- | --- |
| npm | `vue-form-json-schema` 2.9.5，npm `time.modified` 2022-05-23；`alpha` 标签 3.0.0-alpha.0；peer `vue ^2.x`；MIT |
| 仓库 | github.com/jarvelov/vue-form-json-schema，356 星，最近推送 2023-03-30，未归档 |

最新稳定版 peer 依赖为 Vue 2，没有 Vue 3 的稳定版；仓库最近推送距今 3 年多。该库的描述写法本次未读，不展开；下表中标“未查”。

## 6. react-jsonschema-form（RJSF，参照，非 Vue）

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 包 | `@rjsf/core`、`@rjsf/utils`、`@rjsf/validator-ajv8`，以及各 UI 主题包（如 `@rjsf/mui`） |
| npm 最新版 | 6.11.0，2026-09-29（GitHub release v6.11.0，2026-09-28） |
| 许可证 | Apache-2.0 |
| 仓库 | github.com/rjsf-team/react-jsonschema-form，15919 星，最近推送 2026-10-20 |
| 包体（解压后） | core 2.47 MB |
| 依赖 | `@rjsf/core` peer `react >=18`、`@rjsf/utils`；`@rjsf/utils` 依赖 `react-is`，peer `react >=18`，另依赖 `jsonpointer`、`fast-equals`、`@x0k/json-schema-merge`；验证器 `@rjsf/validator-ajv8` 依赖 `ajv ^8.20.0` |

### 描述写法

数据 schema 与 `uiSchema` 分开，`uiSchema` 的层级与表单字段层级一致（官方 uiSchema 页，摘要）。指令既可写成 `'ui:name': value`，也可写进 `'ui:options': { name: value }`。指令包括：`ui:widget`（覆盖控件，如 `'password'`）、`ui:readonly`（字段及其子字段只读，文字可选）、`ui:disabled`、`ui:order`、`ui:field`、`ui:title`、`ui:help`、`ui:placeholder`、`ui:enumNames`。数组项选项里该页只展示了 `orderable`，`addable`、`removable` 在 arrays 页（该页未读）。

示例（按官方语法写，示例未运行；字段未写 `ui:` 的就用默认控件）：

```js
const uiSchema = {
  id: { 'ui:readonly': true },
  name: { 'ui:title': '名称' },
  apiFormat: { 'ui:widget': 'radio' },
  apiKey: { 'ui:widget': 'password' },
  extra: { 'ui:widget': 'textarea' },
}
```

条件显示：官方 dependencies 页（摘要）说明 RJSF 支持 `dependencies`（属性依赖、schema 依赖，schema 依赖里可用受限 `oneOf` 按选择显示后续字段），并注明这是“不属于最新 JSON Schema 规范”的早期草案关键字。`if/then/else` 在该页没有提到，本次未核实。条件显示是靠 schema 本身的组合关键字改变要渲染的字段，不是 `uiSchema` 里的规则。并排布局：RJSF 默认主题没有声明式并排，需自写 `ObjectFieldTemplate`（模板机制见下；具体写法未核实）。

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象与数组 | 内置；数组项选项 `orderable` 等（arrays 页） |
| 条件显示 | `dependencies`（见上） |
| 字段联动 | 无声明式联动协议；官方文档中的自定义 Field 与 `formContext` 等机制本次未读 |
| 动态选项（异步） | 本次未查到 |
| 校验与错误显示 | 必须传 `validator`（如 `@rjsf/validator-ajv8`）；自定义错误信息机制本次未读 |
| 只读展示 | `ui:readonly`、`ui:disabled` |
| 国际化 | registry 里含 `translateString`（官方 custom-widgets-fields 页）；本地化语言列表本次未查 |
| 自定义控件登记 | `widgets` prop（键名在 `uiSchema` 里用 `ui:widget` 引用，官方称“适合把 uiSchema 作为纯 JSON 暴露”）、`fields` prop（`ui:field`）、`templates`；`registry` 对象在组件树里下传 |
| 与 TypeBox 的 JSON Schema | 输入就是 JSON Schema（TS 类型 `RJSFSchema`）；未实测 |

### 换成自有组件库

主题机制：主题提供自己的 fields、widgets、templates，并与核心和自定义项合并进 registry（custom-widgets-fields 页的描述；“Custom Themes”页未读）。

### 非浏览器复用

`@rjsf/utils`（含 schema 工具函数）在 npm 上 peer 依赖 `react >=18`，`@rjsf/core` 同样；因此 core 与 React 没有解耦到“无 React 依赖”的程度（npm 元数据）。

### 未查到

arrays 页的 `addable`、`removable` 细节；Custom Themes 页；`if/then/else` 支持情况；本地化语言。

# 二、生成式／Agent 界面类

## 7. MCP elicitation（模型上下文协议的“向用户索取信息”）

### 基本信息

| 项 | 值 |
| --- | --- |
| 读取的页面 | `modelcontextprotocol.io/specification/draft/client/elicitation`（draft 版，2026-10-20 读取原文） |
| 版本说明 | 该页写明：URL 模式（URL mode）“introduced in the `2025-11-25` version of the MCP specification”；draft 版里 elicitation 请求经 `InputRequiredResult` 里的 `elicitation/create` 传递，并有“multi round-trip requests”机制。已发布各版本的细节差异本次未逐版核对 |
| 参考实现 | `@modelcontextprotocol/sdk` 1.32.1，MIT，npm 2026-10-05（检索；未读其 elicitation 接口） |
| 规范仓库 | github.com/modelcontextprotocol/modelcontextprotocol，9485 星，许可证字段 NOASSERTION（检索） |

### 请求与返回

请求参数：`mode`（`form` 或 `url`；form 可省略）、`message`；form 模式另有 `requestedSchema`，url 模式另有 `url`。

`requestedSchema` 是 JSON Schema 的“受限子集”。页面原文：“form mode elicitation schemas are limited to flat objects with primitive properties only.” 允许的原子类型：

- 字符串：`title`、`description`、`minLength`、`maxLength`、`format`（支持 `email`、`uri`、`date`、`date-time`）、`default`。
- 数字（`number`／`integer`）：`minimum`、`maximum`、`default`。
- 布尔：`default`。
- 枚举：单选可用 `enum`，或用 `oneOf: [{const, title}]` 带显示名；多选为 `type: "array"` + `minItems`／`maxItems` + `items`（`enum` 或 `anyOf: [{const, title}]`）。

页面原文：“complex nested structures, arrays of objects (beyond enums), and other advanced JSON Schema features are intentionally not supported to simplify client user experience.” 客户端可以用它“生成输入表单”“发送前校验”；支持 `default` 的客户端应预填。

返回：`{ "action": "accept" | "decline" | "cancel", "content": {...} }`。`accept` 表示用户明确批准并提交（form 模式带 `content`，url 模式省略）；`decline` 表示明确拒绝；`cancel` 表示未做明确选择就关闭（关对话框、按 Esc 等）。

请求示例（页面原文）：

```json
{
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "Your full name" },
        "email": { "type": "string", "format": "email", "description": "Your email address" },
        "age": { "type": "number", "minimum": 18, "description": "Your age" }
      },
      "required": ["name", "email"]
    }
  }
}
```

### 能力边界（与本项目场景对照时可引用的事实）

- 平铺对象、只有原子类型；没有嵌套对象、对象数组、条件显示、字段联动、只读展示、异步选项、布局描述（页面未定义这些）。
- 敏感信息：页面警告框原文：“Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials”，且“**MUST** use URL mode for interactions involving such sensitive information”。“Form Mode Security”节再次写：“Servers MUST NOT request sensitive information (passwords, API keys, etc.) via form mode”。URL 模式下“Data (other than the URL itself) is **not** exposed to the client”。
- 客户端义务：说明是哪个服务器在索取；提供清晰的拒绝与取消选项；form 模式下允许用户在发送前审阅和修改；“Clients **SHOULD** validate all responses against the provided schema”，服务器也应校验。
- 国际化、自定义控件：页面不涉及（客户端自行渲染）。
- 与 TypeBox：`requestedSchema` 本身是标准 JSON Schema 子集，TypeBox 生成的平铺 schema 在形式上落在允许范围内，但 TypeBox 默认生成的 `Type.String({format:...})` 以外的 format 不在上述列表内（推断，未实测）。
- 非浏览器：协议只规定数据，渲染由客户端决定，页面写明“the protocol itself does not mandate any specific user interaction model”。

### 未查到

2025-06-18、2025-11-25 已发布版本里 `requestedSchema` 子集与 draft 是否完全一致；SDK 里的校验实现。

## 8. Google A2UI（Agent-to-UI）

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 仓库 | github.com/google/A2UI，16747 星，创建于 2025-09-24，最近推送 2026-10-20；许可证 Apache-2.0 |
| 状态 | README：“Early stage public preview”；“current production release is v0.9.1”，“v1.0 specification is a release candidate”，“v0.8 is legacy”，“Expect changes” |
| 协议文档 | `specification/v0_9_1/docs/a2ui_protocol.md`：Version 0.9.1，Status “Current Production”，Created Nov 20 2025，Last Updated Dec 3 2025 |
| npm 包 | `@a2ui/web_core` 0.14.0、`@a2ui/lit` 0.14.0、`@a2ui/react` 0.14.0、`@a2ui/angular` 0.13.0、`@a2ui/markdown-it` 0.2.2，均 Apache-2.0，npm 2026-10-17；另有 Python（`a2ui-core` 等）、Dart、Kotlin、Swift 实现（仓库目录）。没有 Vue 渲染器：`typescript/renderers` 下是 angular、lit、markdown-it、react、web_core |
| 依赖 | `@a2ui/web_core` 依赖 `lit`、`zod`、`@lit/context`、`redos-detector`、`validate-color`、`zod-to-json-schema`、`@preact/signals-core`（npm 元数据） |

### 机制

- 消息：服务器到客户端是 JSON 对象流，四种消息：`createSurface`、`updateComponents`、`updateDataModel`、`deleteSurface`。组件为扁平列表，用 ID 引用建树（邻接表模型），必须有 id 为 `root` 的组件；数据模型与界面结构分开，用 JSON Pointer 绑定（A2UI 扩展了不以 `/` 开头的相对路径，用于列表模板）。
- 为什么不输出代码（README 原文）：“Running arbitrary code generated by an LLM may present a security risk. A2UI is a declarative data format, not executable code. Your client application maintains a “catalog” of trusted, pre-approved UI components (e.g., Card, Button, TextField), and the agent can only request to render components from that catalog.”；并称要达到 “safe like data, but expressive like code”。
- 组件目录：每个 surface 的 `createSurface` 带 `catalogId`；目录本身是一份 JSON Schema（含组件、函数、主题）。协议文档：“Defining your own catalog allows you to restrict the agent to using exactly the components and visual language that exist in your application.” 目录需把子组件引用写成 `ComponentId`、列表写成 `ChildList`，校验器据此检查父子引用是否存在。
- 校验模型输出（v0.9 的“prompt-first”）：协议文档写明 v0.9 把 schema 嵌进提示词而不依赖结构化输出，代价是“requires more complex post-generation validation, as the LLM is not strictly constrained by the schema”。推荐循环 Prompt → Generate → Validate，失败时按标准格式回报 `{"error":{"code":"VALIDATION_FAILED","surfaceId","path","message"}}` 让模型自纠。
- 动作与函数：`Button` 的 `action.event` 可带 `context`（引用数据路径）发回服务器；客户端函数按名字在目录里登记（`required`、`regex`、`length`、`numeric`、`email`、`formatString`、`formatNumber`、`formatCurrency`、`formatDate`、`pluralize`、`openUrl`、`and`、`or`、`not`），原文：“This avoids sending executable code.”
- 自定义目录／“Smart Wrapper”：README 称开放的注册表模式让开发者把服务端类型映射到自定义客户端实现，“places security firmly in the developer's hands”，沙箱与信任分级由开发者在自定义组件内实现（README，摘要性描述）。

基础目录（`catalogs/basic/catalog.json`，v0.9.1）组件：Text、Image、Icon、Video、AudioPlayer、Row、Column、List、Card、Tabs、Modal、Divider、Button、TextField、CheckBox、ChoicePicker、Slider、DateTimeInput。`TextField` 的 `variant` 取 `longText | number | shortText | obscured`，另有 `validationRegexp`；`ChoicePicker` 的 `variant` 取 `multipleSelection | mutuallyExclusive`，`options` 为 `{label, value}`；输入组件与数据模型双向绑定，且“Two-Way Binding is local to the client”，只有触发 action 才发给服务器；输入组件可带 `checks`（`call`、`args`、`message`），`Button` 的 `checks` 失败时按钮自动禁用。

### 示例（按 v0.9.1 协议文档语法写，示例未运行；协议文档里没有“只读”“条件显示”“对象数组增删”，所以“服务商连接”示例省略这几项）

```json
[
  { "version": "v0.9.1", "createSurface": { "surfaceId": "provider", "catalogId": "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json", "sendDataModel": true } },
  { "version": "v0.9.1", "updateComponents": { "surfaceId": "provider", "components": [
    { "id": "root", "component": "Column", "children": ["name", "apiBase", "apiFormat", "apiKey", "limits", "submit"] },
    { "id": "name", "component": "TextField", "label": "名称", "value": { "path": "/provider/name" },
      "checks": [{ "call": "required", "args": { "value": { "path": "/provider/name" } }, "message": "必填" }] },
    { "id": "apiBase", "component": "TextField", "label": "API Base", "value": { "path": "/provider/apiBase" } },
    { "id": "apiFormat", "component": "ChoicePicker", "label": "接口格式", "variant": "mutuallyExclusive",
      "options": [{ "label": "OpenAI", "value": "openai" }, { "label": "Anthropic", "value": "anthropic" }],
      "value": { "path": "/provider/apiFormat" } },
    { "id": "apiKey", "component": "TextField", "label": "API Key", "variant": "obscured", "value": { "path": "/provider/apiKey" } },
    { "id": "limits", "component": "Row", "children": ["timeout", "retries"] },
    { "id": "timeout", "component": "TextField", "label": "超时", "variant": "number", "value": { "path": "/provider/timeoutMs" } },
    { "id": "retries", "component": "TextField", "label": "重试", "variant": "number", "value": { "path": "/provider/retries" } },
    { "id": "submit", "component": "Button", "child": "submitLabel",
      "action": { "event": { "name": "save", "context": { "provider": { "path": "/provider" } } } } },
    { "id": "submitLabel", "component": "Text", "text": "保存" }
  ] } }
]
```

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象、对象数组 | 数据模型是任意 JSON，`List`／`ChildList` 模板可对数组中每项实例化子组件（相对路径）；增删排序在基础目录里没有对应组件（按组件表，未发现） |
| 条件显示、禁用 | 基础目录 JSON 中没有 visible／hidden／enabled／disabled 属性（对 `catalog.json` 的关键字检索，仅 `Button.checks` 能禁用按钮） |
| 联动 | 函数 `and`／`or`／`not`、`formatString` 等可组合数据绑定值；无声明式联动协议 |
| 动态选项 | `ChoicePicker.options` 的 `label` 是 `DynamicString`（可绑定数据）；选项整体是否可绑定路径，本次未核实 |
| 校验与错误显示 | 输入组件 `checks` + 目录函数，失败显示 `message` |
| 国际化 | 有 `pluralize`、`formatDate` 等函数；整体国际化机制本次未读 |
| 自定义控件登记 | 自定义目录（JSON Schema）加各渲染器里的组件映射；`typescript/renderers` 的注册 API 本次未读 |
| 与 TypeBox | 不是同一套：A2UI 的目录就是 JSON Schema，可以用 TypeBox 生成，但界面描述走 A2UI 自己的消息格式，不能直接吃“数据 schema” |

### 换成自有组件库与非浏览器复用

渲染器负责把抽象组件映射为本地实现（README）。官方渲染器只有 Lit、React、Angular、Flutter 等；无 Vue。`@a2ui/web_core` 依赖 `lit` 和 `@preact/signals-core`，是否能在无 DOM 环境使用本次未核实。Python／Kotlin／Swift 实现说明协议与具体 UI 框架解耦，但没有终端渲染器的记载。

### 未查到

v1.0 候选版（`specification/v1_0`）与 v0.9.1 的差别；Vue 或终端渲染器；`@a2ui/web_core` 在 Node 下的使用方式。

## 9. Vercel json-render

### 基本信息（检索）

| 项 | 值 |
| --- | --- |
| 仓库 | github.com/vercel-labs/json-render，18727 星，创建于 2026-01-14，最近推送 2026-10-13；Apache-2.0；GitHub 上 30 个 release |
| 最新版 | `@json-render/*` 全家桶 0.21.1，npm 2026-10-13（0.x，API 可能变动） |
| 关键包 | `@json-render/core`（依赖并 peer `zod ^4`；解压 1.22 MB）、`@json-render/vue`（Vue 3 渲染器，peer `vue ^3.5.0`、`zod ^4`，依赖 core；解压 518 KB）、`@json-render/ink`（终端渲染器，peer `ink ^6`、`react ^19`）、`@json-render/mcp`（MCP Apps 集成）、`@json-render/shadcn`（36 个 React＋Radix＋Tailwind 组件，仅 React）、`@json-render/directives`（`$format`、`$math`、`$t` 国际化等指令）、`@json-render/yaml` |
| 其他渲染器 | React、Svelte 5、Solid、React Native、Remotion、PDF、Email、Image、Three.js、Next.js、TanStack Start（README 包表） |

### 机制

- 目录（catalog）：用 `defineCatalog(schema, { components: { Card: { props: z.object({...}), description } }, actions: { export_report: { description } } })` 定义，组件的 props 用 Zod 描述。README：“AI can only use components in your catalog”“Predictable - JSON output matches your schema, every time”。目录提供 `catalog.prompt()`（生成系统提示词）、`catalog.jsonSchema({strict})`（导出可用于各家结构化输出的严格 JSON Schema 子集）、`catalog.validate(spec)`、`catalog.zodSchema()`（`@json-render/core` 的类型定义）。严格模式的已知限制（类型定义注释）：Record／map 类型无法表示，只会导出为空对象；完整结构由 `catalog.prompt()` 描述。
- Spec 格式：扁平的 `root` + `elements` 映射；每个元素有 `type`、`props`、`children`，可选 `visible`（条件）、`on`（事件到动作）、`repeat: { statePath, key }`（对 state 数组重复子元素）、`watch`（状态路径变化触发动作）、`slots`。
- 校验模型输出：两层。一是 `catalog.validate(spec)`（Zod 结构校验）；二是 `validateSpec(spec)` 的结构检查，问题码有 `missing_root`、`root_not_found`、`missing_child`、`invalid_visible`、`repeat_without_children`、`repeat_item_outside_scope`、`visible_in_props`、`orphaned_element` 等，用来抓“AI 生成时的常见错误”；另有 `autoFixSpec` 自动修复部分问题（`@json-render/core` 的类型定义与注释）。
- 动态值：`{ "$state": "/path" }`、`{ "$cond": ..., "$then": ..., "$else": ... }`、`{ "$template": "Hello, ${/user/name}!" }`、`{ "$computed": "fn", "args": {...} }`、双向绑定 `{ "$bindState": "/path" }`（README）。动作内置 `setState`，其余动作须在目录里声明并由应用提供实现。读 `@json-render/core@0.21.1` 的 `dist/index.js`：没有 `new Function` 或 `eval` 调用（对这两个关键字的检索结果为空）。
- 校验（表单字段）：元素 props 里写 `checks: [{ type, args?, message }]` 和 `validateOn: "change" | "blur" | "submit"`、`enabled`（条件）；内置 `required`、`email`、`minLength`、`maxLength`、`pattern`、`min`、`max`、`numeric`、`url`、`matches`／`equalTo`、`lessThan`、`greaterThan`、`requiredIf`；自定义校验器在目录 `functions` 里声明，实现通过 `ValidationProvider` 提供，可以是异步函数（官方 validation 页，`json-render.dev/docs/validation`）。
- 安全边界的说法：README 只说“constrained to components you define”“Predefined components and actions for safe, predictable output”，没有单独的威胁模型说明；对 TSX／代码输出的取舍，本次在 README 里未见专门论述。

### 描述写法与示例

数据与界面不分：状态模型是任意 JSON，元素用 `$bindState` 绑定到状态路径。**json-render 不带 Vue 的表单控件库**：`@json-render/shadcn` 只有 React 版，`@json-render/vue` 是渲染器本身（README 的 Vue 示例里 `Card`、`Button` 由使用者在 `defineRegistry` 里自己写）。因此示例里的 `TextField`、`Select`、`SecretField`、`JsonEditor` 都是“假定在目录里自己定义”的组件名（示例未运行；元素字段名来自 README 与类型定义，条件写法仿 README 的 `visible` 与 `$cond` 示例）：

```json
{
  "root": "form",
  "elements": {
    "form": { "type": "Column", "props": {}, "children": ["id", "name", "apiBase", "apiFormat", "apiKey", "limits", "extra", "proxy"] },
    "id": { "type": "TextField", "props": { "label": "ID", "value": { "$bindState": "/provider/id" }, "readOnly": true }, "children": [] },
    "name": { "type": "TextField", "props": { "label": "名称", "value": { "$bindState": "/provider/name" },
      "checks": [{ "type": "required", "message": "必填" }], "validateOn": "blur" }, "children": [] },
    "apiBase": { "type": "TextField", "props": { "label": "API Base", "value": { "$bindState": "/provider/apiBase" },
      "checks": [{ "type": "url", "message": "不是有效地址" }] }, "children": [] },
    "apiFormat": { "type": "Select", "props": { "label": "接口格式", "options": ["openai", "anthropic"],
      "value": { "$bindState": "/provider/apiFormat" } }, "children": [] },
    "apiKey": { "type": "SecretField", "props": { "label": "API Key", "value": { "$bindState": "/provider/apiKey" } }, "children": [] },
    "limits": { "type": "Row", "props": {}, "children": ["timeout", "retries"] },
    "timeout": { "type": "TextField", "props": { "label": "超时", "value": { "$bindState": "/provider/timeoutMs" } }, "children": [] },
    "retries": { "type": "TextField", "props": { "label": "重试", "value": { "$bindState": "/provider/retries" } }, "children": [] },
    "extra": { "type": "JsonEditor", "props": { "label": "扩展参数", "value": { "$bindState": "/provider/extra" } }, "children": [] },
    "proxy": { "type": "TextField", "props": { "label": "代理", "value": { "$bindState": "/provider/proxy" } },
      "visible": { "$state": "/provider/apiFormat", "eq": "openai" }, "children": [] }
  }
}
```

### 能力清单

| 项 | 事实 |
| --- | --- |
| 嵌套对象 | 状态是任意 JSON，`$bindState` 取任意 JSON Pointer 路径 |
| 对象数组增删排序 | `repeat: { statePath, key }` 按数组重复渲染子元素，项内用 `$item`／`$index`／`$bindItem`；增删排序要靠自定义动作修改数组（内置动作只确认 `setState`，其余本次未读） |
| 条件显示 | 元素 `visible`：`$state` 加 `eq`／`not` 等，数组为隐式 AND，另有 `$and`／`$or`（类型定义） |
| 字段联动 | `watch`（状态路径变化触发动作，不在初次渲染时触发）、`$cond`、`$computed` |
| 动态选项（异步） | 官方给出的模式是 `watch` 触发动作（README 示例：国家变化触发 `loadCities`）；异步结果如何写回状态由动作实现决定 |
| 校验与错误显示 | 见上，`checks` + `validateOn`，内置校验函数 13 个，支持异步自定义校验 |
| 只读展示 | 没有统一的只读字段；只能由目录里的组件自行提供（如上例的 `readOnly` prop 是自定义的） |
| 国际化 | `@json-render/directives` 含 `$t`（README 包表），机制细节本次未读 |
| 自定义控件登记 | `defineRegistry(catalog, { components: {...} })`，Vue 版组件是函数 `({ props, children, emit }) => VNode` |
| 与 TypeBox 的 JSON Schema | 不能直接用：目录里的 props 必须是 Zod 4 schema；core 依赖 `zod ^4`。TypeBox 与 Zod 之间的互转本次未调研 |

### 换成自有组件库

`defineRegistry` 里为目录中的每个组件写一个 Vue 渲染函数即可，目录与渲染分开；Vue 渲染器 0.21.1 不带预制控件。

### 非浏览器复用

`@json-render/core` 不依赖 UI 框架（依赖只有 `zod`）。官方有终端渲染器 `@json-render/ink`（Ink＋React，peer `react ^19`）。读其 `dist/catalog.js`，标准组件含 `TextInput`、`Select`、`MultiSelect`、`ConfirmInput`、`Card`、`Table`、`Tabs`、`KeyValue`、`ProgressBar`、`Spinner`、`Markdown` 等 25 个左右。同一份 spec 能由 Vue 与 Ink 两个渲染器各自渲染，前提是两个渲染器注册了同名组件、同样的 props（README 称“same catalog”跨 React、Vue、Svelte、Solid 渲染；跨 Vue 与 Ink 的实际同源渲染本次未实测）。

### 其他可见的相关集成

官方文档侧栏有 “A2UI Integration”“Adaptive Cards Integration”“AG-UI Integration”“OpenAPI Integration”，其中 A2UI 页自称 “Concept ... examples are illustrative and may require adaptation for production use”（`json-render.dev/docs/a2ui`）。`@json-render/mcp` 称为 “MCP Apps integration for Claude, ChatGPT, Cursor, VS Code”（README 包表）。

### 未查到

安全模型的专门文档；`repeat` 的完整示例；内置动作清单；`$bindItem` 的写法细节；Vue 渲染器的 slots／事件细节。

## 10. 其他同类做法（只记机制）

### MCP Apps（模型上下文协议的扩展）

来源：`modelcontextprotocol.io/extensions/apps/overview`（官方文档，2026-10-20 读取原文）。机制：工具在描述里用 `_meta.ui.resourceUri` 指向一个 `ui://` 资源，资源内容是 HTML 页面；宿主取回后“typically render the HTML inside a sandboxed iframe”；应用与宿主通过 postMessage 上的 JSON-RPC 通信（`ui/` 前缀方法，以及 `tools/call` 等）。安全模型原文：沙箱阻止应用访问父窗口的 DOM、宿主的 cookie 与 local storage、导航父页面、在父上下文执行脚本；“The host controls which capabilities your app can access”；资源的 `_meta.ui` 可带 `permissions` 与 `csp`。该页称它适用的场景包括“Configuring with many options ... presents a form where users see all options at once, with validation and defaults”。即：这条路线是让服务器提供**整页 HTML／JS**，用沙箱隔离，而不是受约束的描述格式。规范文档 `specification/2026-01-26/apps.mdx`（页面链接）。支持的客户端包括 Claude、Claude Desktop、VS Code GitHub Copilot 等（页面列表）。包：`@modelcontextprotocol/ext-apps`。

### OpenAI Apps SDK

来源：`developers.openai.com/apps-sdk/build/chatgpt-ui`（官方文档，WebFetch 摘要）。机制：MCP 服务器把组件作为 MIME 类型 `text/html;profile=mcp-app` 的资源暴露，esbuild 打成单个 JS 模块内联进资源的 `text`；工具用 `_meta.ui.resourceUri`（ChatGPT 也认 `_meta["openai/outputTemplate"]`）引用；组件在 ChatGPT 的 iframe 里运行，经 postMessage JSON-RPC 与宿主通信；页面列出 `window.openai` 的一组扩展（如 `toolInput`、`toolOutput`、`callTool`、`sendFollowUpMessage`、`widgetState`）。安全说法（摘要中的引文）：“Declare the exact domains the component connects to or loads resources from.”“Nested frames are blocked by default.”工具数据“treated as untrusted input”；“The plugin review process checks the declared policy against the UI behavior.”

### OpenAI ChatKit widgets

来源：`developers.openai.com/api/docs/guides/chatkit-widgets`（官方文档，WebFetch 摘要）。机制：一个 `WidgetRoot` 容器包含若干 `WidgetNode`；在 ChatKit Studio 的 Widget Builder 里设计后“copy the generated JSON into your integration and serve it from your backend”。组件：容器 Card、ListView；布局 Box、Row、Col、Form、Transition、Spacer、Divider；内容 Text、Title、Caption、Markdown、Badge、Icon、Image；交互 Button、Select、DatePicker、ListViewItem。摘要称页面未列 Input 组件，文字可通过 `editable` 选项变成可编辑，`editable` 有 `required`、`pattern` 字段。动作用 `onAction` 回调捕获，Form 有 `onSubmitAction`，Button 有 `submit` 标志。这是“固定组件集合 + JSON 描述”路线，与 A2UI、json-render 同类，但组件集合由 OpenAI 规定；其数据模型与校验说明页面没有展开。

### Adaptive Cards

只有 json-render 文档侧栏列出 “Adaptive Cards Integration”，本次未读其官方文档，不记录。

### 未查到

Apps SDK／ChatKit 的版本号与发布日期、许可证；ChatKit widgets 的完整数据绑定说明。

# 三、横向对照表（只列事实，不打分、不推荐）

“未查”表示本次调研没有核实到；“无”表示在已读的官方文档或源码里没有找到对应机制，不等于一定不存在。

## 表一：schema 表单类

| 项 | JSON Forms | FormKit | Formily | vue-json-schema-form（lljj） | vue-form-json-schema | RJSF |
| --- | --- | --- | --- | --- | --- | --- |
| 最新版（npm） | 3.8.0（2026-08-06） | 2.1.2（2026-07-24） | 2.3.7（2025-05-15） | 1.19.0（2023-10-05） | 2.9.5（2022-05-23） | 6.11.0（2026-09-29） |
| 许可证 | MIT | 核心 MIT；Pro 另有许可 | MIT | Apache-2.0 | MIT | Apache-2.0 |
| 仓库星数／最近推送 | 2748／2026-10-19 | 4778／2026-07-24 | 12588／2025-06-21 | 2267／2026-05-20（仅文档类） | 356／2023-03-30 | 15919／2026-10-20 |
| 面向的框架 | React、Angular、Vue 3（Vue 为 preview） | Vue 3、React | React、Vue（2 与 3） | Vue 2、Vue 3 | Vue 2 | React |
| 描述格式 | JSON Schema + 独立 UI schema（`scope` 指针） | FormKit 自有节点数组（非 JSON Schema） | JSON Schema + `x-*` 扩展（数据与界面同节点） | JSON Schema + `ui:` 键（schema 内或独立 uiSchema） | 未查 | JSON Schema + 独立 `uiSchema` |
| 直接吃 JSON Schema | 是 | 否 | 部分（界面须加 `x-*`） | 是 | 未查 | 是 |
| 条件显示 | `rule`（声明式，条件是 JSON Schema） | 节点 `if` 表达式 | `x-reactions` 改 `visible`（表达式） | `ui:hidden` 表达式 | 未查 | `dependencies` 等 schema 关键字 |
| 表达式是否执行字符串代码 | 否（条件为 JSON Schema） | 受限表达式语言（FormKit 自行解析） | 是（`new Function` + `with`，源码） | 是（`new Function`，源码） | 未查 | 无表达式 |
| 对象数组增删排序 | 有（vanilla `ArrayListRenderer`，`showSortButtons`） | `repeater`（授权归属未能确认） | 依赖 UI 库数组组件 | 未查 | 未查 | 内置，选项 `orderable` 等 |
| 只读展示 | `readonly`（prop、options） | 无专门模式（可用 `disabled`） | `x-pattern`: `readOnly`／`disabled`／`readPretty` | 未查 | 未查 | `ui:readonly`、`ui:disabled` |
| 国际化 | `i18n` prop；内置渲染器集尚不可翻译 | `@formkit/i18n`，47 个 locale | 未查 | `vjsf-utils` 有 i18n 目录 | 未查 | registry 有 `translateString` |
| 校验 | AJV（可传实例）；`additionalErrors` | 管道字符串规则，30 多条 | `@formily/validator`，`x-validator` | ajv | 未查 | 须传 validator（如 ajv8） |
| 自定义控件登记 | `{renderer, tester}` + `rankWith` | `createInput`、`inputs`、plugin `library` | `createSchemaField({components})` | `ui:widget`／`ui:field` 注册名或组件 | 未查 | `widgets`／`fields`／`templates` prop |
| 自有组件库适配方式 | 自写一套 renderer 集（vue-vanilla 作参照）；或 `styles` 换类名 | `createInput` 包装自有组件 | 自备 FormItem 与各输入组件，`connect` 接入 | 仿现有适配包新写一个 | 未查 | 自写主题（fields、widgets、templates） |
| Vue 3 官方 UI 适配 | vue-vanilla、vue-vuetify | 自带（含主题包） | `@formily/element-plus` 1.1.0（2024-07） | Element Plus、Ant、Naive | 无稳定版 | 不适用 |
| 核心包是否带 UI 框架依赖 | `@jsonforms/core` 无 | `@formkit/core` 仅依赖 `@formkit/utils` | `@formily/core` 无 | core 经 `vjsf-utils` 带 Vue 组件 | 未查 | `@rjsf/utils` peer 依赖 React |
| 官方终端渲染器 | 无 | 无 | 无 | 无 | 无 | 无 |

## 表二：生成式／Agent 界面类

| 项 | MCP elicitation（form 模式） | A2UI | json-render | MCP Apps／OpenAI Apps SDK | ChatKit widgets |
| --- | --- | --- | --- | --- | --- |
| 版本／状态 | draft 规范页；URL 模式自 2025-11-25 起 | 协议 0.9.1（Current Production），v1.0 候选；npm 0.14.0（2026-10-17）；官方称 early stage public preview | 0.21.1（2026-10-13） | MCP Apps 规范日期 2026-01-26 | 未查 |
| 许可证 | 规范仓库字段 NOASSERTION；SDK MIT | Apache-2.0 | Apache-2.0 | 未查 | 未查 |
| 模型输出的是 | JSON Schema 子集（平铺对象） | JSON 消息流（组件邻接表 + 数据模型） | JSON spec（`root` + `elements`） | 整页 HTML／JS（服务器提供） | JSON 组件树 |
| 组件由谁限定 | 协议固定：字符串、数字、布尔、枚举、枚举数组 | 目录（JSON Schema），可自定义目录 | 目录（Zod 4 schema），可自定义 | 不限定（沙箱隔离） | OpenAI 规定的组件集合 |
| 校验模型输出 | 客户端用 `requestedSchema` 校验，服务器也应校验 | 对目录 schema 校验，失败按 `VALIDATION_FAILED` 格式回报给模型 | `catalog.validate`、`validateSpec`、`autoFixSpec` | 不适用（宿主审查／CSP 声明） | 未查 |
| 表达式／代码执行 | 无 | 无可执行代码，客户端函数按名字调用 | 对 `new Function`／`eval` 的检索为空（`core` 0.21.1 的 `dist/index.js`） | 页面内可执行任意脚本，靠 iframe 沙箱 | 未查 |
| 条件显示 | 无 | 基础目录无 visible 属性 | `visible`（`$state` 条件） | 页面自己实现 | 未查 |
| 对象数组 | 不支持 | `ChildList` 模板（相对路径） | `repeat` | 页面自己实现 | 未查 |
| 只读展示 | 无 | 基础目录无只读属性 | 无统一机制 | 页面自己实现 | 未查 |
| 密钥项 | 规范禁止在 form 模式索取密钥，须用 URL 模式 | `TextField.variant: "obscured"` | 自定义组件 | 页面自己实现 | 未查 |
| Vue 3 渲染器 | 不适用（客户端自行实现） | 无（官方为 Lit、React、Angular、Flutter 等） | `@json-render/vue`（无预制控件） | 示例模板含 Vue（`basic-server-vue`） | 未查 |
| 终端渲染器 | 不适用 | 无 | `@json-render/ink`（含 `TextInput`、`Select`、`MultiSelect`、`ConfirmInput`） | 无 | 未查 |
| 与 TypeBox 的关系 | `requestedSchema` 是标准 JSON Schema 子集 | 目录本身是 JSON Schema | 目录 props 必须用 Zod 4 | 不涉及 | 不涉及 |

# 四、全文未查到的信息汇总

- vue-form-json-schema 的描述写法、功能与文档（只查了版本与仓库状态）。
- lljj 的官方文档站（证书错误，未读取）。
- Formily 的国际化、异步选项示例、Vue 3 官方入门页（返回 404）。
- FormKit：form 级禁用、Repeater 授权归属、`@formkit/zod`。
- JSON Forms：异步选项、条件组合文档、Vue 里自定义 renderer 的完整官方教程。
- MCP elicitation：已发布各版本与 draft 的 `requestedSchema` 子集差异；SDK 实现。
- A2UI：v1.0 候选版差异；`@a2ui/web_core` 在 Node 下的使用方式。
- json-render：专门的安全模型文档；内置动作全清单；TypeBox 与 Zod 的互转。
- OpenAI Apps SDK、ChatKit widgets、Adaptive Cards：版本、许可证。
- 所有库的打包后运行时体积（只记了 npm 解压后大小）；所有库的真实运行（本次没有安装或运行任何库，各示例均未执行）。
