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
import type {CommitMode, DraftState, FormMode, FormOptionSources} from "./scope";

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
    mode?: FormMode;
    readonly?: boolean;
    disabled?: boolean;
    issues?: ReadonlyArray<FormIssue>;
    meta?: FormMeta;
    options?: FormOptionSources;
    commit?: CommitMode;
    revision?: number;
}>(), {
    hints: undefined,
    modelValue: undefined,
    id: undefined,
    bare: false,
    labelledby: undefined,
    mode: "edit",
    readonly: false,
    disabled: false,
    issues: () => [],
    meta: () => ({}),
    options: () => ({}),
    commit: "change",
    revision: 0,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: unknown): void;
    (event: "draft-state", state: DraftState): void;
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
});
provideFormScope(scope);

defineExpose({
    /** 提交可解析的草稿；不可解析时返回 false。 */
    commit: (): boolean => scope.handle("")?.commit() ?? true,
    reset: (): void => scope.handle("")?.reset(),
    focus: (): void => scope.handle("")?.focus(),
});
</script>

<template>
    <NodeField :node="model.root" :bare="props.bare" :id="props.id" :labelledby="props.labelledby" />
</template>
