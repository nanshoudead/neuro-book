<script setup lang="ts">
/**
 * 把登记的自定义控件接进字段（docs/specs/ui/forms.md 输出 22，合同见 `widgets.ts`）：交给它字段的 id、说明关联、问题、
 * 选项与带外状态；它发出的 `update:modelValue` 是草稿，按提交时机提交（`input` 立即，`change` 在 `commit` 事件或焦点
 * 离开字段时）。外部的值或 `revision` 变化、且字段没有焦点时丢掉草稿。
 */
import {useFieldContext} from "@notnotype/nb-ui/components";
import {computed, ref, shallowRef, useTemplateRef, watch} from "vue";

import {toPointer} from "../../path";
import {issuesAt, useFormScope} from "../scope";
import type {FormWidget} from "../widgets";
import type {ControlProps, DraftControl} from "./control";

const props = defineProps<ControlProps & {readonly widget: FormWidget}>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const scope = useFormScope();
const field = useFieldContext();
const pending = shallowRef<{readonly value: unknown} | null>(null);
const focused = ref(false);
const inner = useTemplateRef<{focus?: () => void}>("inner");

const shownValue = computed(() => (pending.value === null ? props.modelValue : pending.value.value));
const options = computed(() => (props.node.hints.options === undefined ? undefined : scope.source(props.node.hints.options)));

function onUpdate(value: unknown): void {
    if (scope.commitMode.value === "input") {
        emit("update:modelValue", value);
        return;
    }
    pending.value = {value};
}

function commit(): boolean {
    const draft = pending.value;
    pending.value = null;
    if (draft !== null) emit("update:modelValue", draft.value);
    return true;
}

watch([() => props.modelValue, scope.revision], () => {
    if (!focused.value) pending.value = null;
});

function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    focused.value = false;
    commit();
}

defineExpose<DraftControl & {focus(): void}>({commit, reset: () => {
    pending.value = null;
}, focus: () => inner.value?.focus?.()});
</script>

<template>
    <div class="nb-form-custom" @focusin="focused = true" @focusout="onFocusOut">
        <component
            :is="props.widget.component"
            ref="inner"
            :model-value="shownValue"
            :node="props.node"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :invalid="props.invalid"
            :id="field?.inputId.value ?? ''"
            :labelledby="field?.labelId.value"
            :describedby="field?.ariaDescribedby.value"
            :locale="props.locale"
            :issues="issuesAt(scope.shownIssues.value, props.node.path)"
            :options="options"
            :meta="scope.meta.value[toPointer(props.node.path)]"
            @update:model-value="onUpdate"
            @commit="commit"
        />
    </div>
</template>

<style scoped>
.nb-form-custom {
    min-width: 0;
}
</style>
