<script setup lang="ts">
/**
 * 按 schema 画一个字段（docs/specs/ui/forms.md，接口见“输入与前置条件”）：值就是这个字段的值。`bare` 时只画控件，
 * 标签与可访问名称由调用方给（设置窗口的一行）。同名 `.md` 写组件合同。
 */
import {computed} from "vue";

import type {FormHints} from "../hints";
import {resolveForm} from "../model";
import type {FormIssue, FormMeta} from "../validate";
import NodeField from "./NodeField.vue";
import {createFormScope, provideFormScope} from "./scope";
import {withHints} from "./with-hints";
import type {CommitMode, DraftState, FieldState, FormMode, FormOptionSources} from "./scope";
import type {FormWidget} from "./widgets";

const props = withDefaults(defineProps<{
    schema: object;
    /** 盖过 schema 里 `x-form` 的同名提示。 */
    hints?: FormHints;
    modelValue?: unknown;
    locale: string;
    /** 控件的 id；`bare` 时调用方的 `<label for>` 指向它。 */
    id?: string;
    bare?: boolean;
    /** `bare` 时组合控件（单选组、复选组）的名字来源：调用方标签元素的 id。 */
    labelledby?: string;
    /** `bare` 时调用方的说明元素的 id，接在字段的错误后面写进 `aria-describedby`。 */
    describedby?: string;
    mode?: FormMode;
    readonly?: boolean;
    disabled?: boolean;
    issues?: ReadonlyArray<FormIssue>;
    meta?: FormMeta;
    options?: FormOptionSources;
    /** 登记的自定义控件（`defineFormWidgets` 的结果，输出 22）。 */
    widgets?: ReadonlyArray<FormWidget>;
    commit?: CommitMode;
    revision?: number;
    /** 根是左列表右详情时的选中项（`v-model:selected`）；缺省由组件自己记。 */
    selected?: number;
}>(), {
    hints: undefined,
    modelValue: undefined,
    id: undefined,
    bare: false,
    labelledby: undefined,
    describedby: undefined,
    mode: "edit",
    readonly: false,
    disabled: false,
    issues: () => [],
    meta: () => ({}),
    options: () => ({}),
    widgets: () => [],
    commit: "change",
    revision: 0,
    selected: undefined,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: unknown): void;
    (event: "draft-state", state: DraftState): void;
    (event: "update:selected", index: number): void;
    /** `bare` 时字段自己的状态（出错、警告、状态原因）变了，挂载时也发一次当前值；调用方画在自己的标题旁。 */
    (event: "field-state", state: FieldState): void;
}>();

const model = computed(() => resolveForm(withHints(props.schema, props.hints)));
const scope = createFormScope({
    model: () => model.value,
    value: () => props.modelValue,
    emitRoot: (next) => emit("update:modelValue", next),
    emitDraft: (state) => emit("draft-state", state),
    mode: () => props.mode,
    readonly: () => props.readonly,
    disabled: () => props.disabled,
    commit: () => props.commit,
    revision: () => props.revision,
    locale: () => props.locale,
    issues: () => props.issues,
    meta: () => props.meta,
    options: () => props.options,
    widgets: () => props.widgets,
    // 根是左列表右详情时，选中项由调用方的 `v-model:selected` 接管（输出 20）。
    selected: {pointer: "", get: () => props.selected, set: (index) => emit("update:selected", index)},
});
provideFormScope(scope);

defineExpose({
    /** 提交字段里（包括对象与列表的成员）所有可解析的草稿，合成一个值发出，并显示全部问题；有草稿提交不了时返回 false。 */
    commit: (): boolean => scope.commitAll(),
    reset: (): void => scope.resetAll(),
    /** 聚焦字段的控件。 */
    focus: (): Promise<boolean> => scope.focusPath([]),
});
</script>

<template>
    <NodeField :node="model.root" :bare="props.bare" :id="props.id" :labelledby="props.labelledby" :describedby="props.describedby" @field-state="emit('field-state', $event)" />
</template>
