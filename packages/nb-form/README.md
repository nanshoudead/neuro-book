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

## 安装

```bash
bun add @notnotype/nb-form
```

只支持 Bun。包里是 TypeScript 与 `.vue` 源码，不带编译产物，由宿主的 Vite 与 Tailwind v4 编译（[ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)、[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。peer 依赖 `vue` 与 `typescript`（编译单文件组件时解析导入的 props 类型要用），Bun 安装时会自动装上；宿主另装 `vite`、`@vitejs/plugin-vue`、`tailwindcss` 与 `@tailwindcss/vite`。许可证 AGPL-3.0-only。
