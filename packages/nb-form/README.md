# @notnotype/nb-form

按数据 schema 画表单。行为合同：[`docs/specs/ui/forms.md`](../../docs/specs/ui/forms.md)。

```ts
import {checkDescription, resolveForm, validateForm} from "@notnotype/nb-form";

const check = checkDescription(schema, {policy: "agent"});   // 模型生成的描述先过检查
const model = resolveForm(schema);                           // 字段树与选中的控件
const issues = validateForm(model, value);                   // 问题按字段路径给出
```

描述是 TypeBox 生成的、或手写的同等 JSON Schema；界面提示写在 `x-form` 里（见 Spec 的“输入与前置条件”）。

Vue 渲染层（`@notnotype/nb-form/vue`）：

```vue
<SchemaForm :schema="schema" v-model="value" locale="zh-CN" :options="{providers}" />
<SchemaField :schema="setting" v-model="value" locale="zh-CN" :id="rowId" bare />
```

组件合同见 [`SchemaForm.md`](src/vue/SchemaForm.md)、[`SchemaField.md`](src/vue/SchemaField.md)。
