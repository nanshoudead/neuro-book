/**
 * `@notnotype/nb-form/vue`：按描述画表单的 Vue 渲染层（docs/specs/ui/forms.md）。只依赖 `vue`、`@notnotype/nb-ui` 与
 * 本包的核心；样式写在组件里、用 nb-ui 的 token，不依赖宿主的原子类引擎。
 */

export {default as SchemaField} from "./SchemaField.vue";
export {default as SchemaForm} from "./SchemaForm.vue";
export {widgetLayout} from "./layout";
export {describeIssues} from "./order";
export type {WidgetLayout} from "./layout";
export type {CommitMode, DraftState, FieldState, FormMode, FormOptionSources} from "./scope";
export {defineFormWidgets, FormWidgetError} from "./widgets";
export type {CustomWidgetProps, FormWidget} from "./widgets";
