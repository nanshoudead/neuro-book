<script setup lang="ts">
/**
 * 数字字段（docs/specs/ui/forms.md 输出 2、15）：草稿按十进制解析，`1.`、`-` 这类不提交。范围与步长取自 schema；
 * 单位画在输入框右边。
 */
import {NumberInput} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {resolveText} from "../../text";
import {numberCodec, useDraft} from "../draft";
import {messagesFor} from "../messages";
import {useFormScope} from "../scope";
import {defaultPlaceholder} from "./placeholder";
import type {ControlProps, DraftControl} from "./control";

const props = defineProps<ControlProps>();

const draft = useDraft({
    node: () => props.node,
    value: () => props.modelValue,
    codec: numberCodec(() => props.node),
    scope: useFormScope(),
});

const schema = computed(() => props.node.schema);
const bound = (key: string) => computed(() => (typeof schema.value[key] === "number" ? String(schema.value[key]) : undefined));
const min = bound("minimum");
const max = bound("maximum");
const step = computed(() => (typeof schema.value.multipleOf === "number" ? String(schema.value.multipleOf) : schema.value.type === "integer" ? "1" : undefined));
const placeholder = computed(() => (props.modelValue === undefined ? defaultPlaceholder(props.node, props.locale) : undefined) ?? resolveText(props.node.hints.placeholder, props.locale));
const unit = computed(() => resolveText(props.node.hints.unit, props.locale));

/** 焦点离开整个控件才提交：点步进按钮时焦点还在里面。 */
function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    draft.focused.value = false;
    draft.commit();
}

defineExpose<DraftControl>({commit: draft.commit, reset: draft.reset});
</script>

<template>
    <div class="nb-form-number" @focusin="draft.focused.value = true" @focusout="onFocusOut">
        <NumberInput
            class="nb-form-number__input"
            :model-value="draft.text.value"
            :min="min"
            :max="max"
            :step="step"
            :placeholder="placeholder"
            :increment-label="messagesFor(props.locale).increment"
            :decrement-label="messagesFor(props.locale).decrement"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :invalid="props.invalid"
            @update:model-value="draft.input"
            @submit="draft.commit()"
        />
        <span v-if="unit" class="nb-form-number__unit">{{ unit }}</span>
    </div>
</template>

<style scoped>
.nb-form-number {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-4);
}

.nb-form-number__input {
    min-width: 0;
    flex: 1 1 auto;
}

.nb-form-number__unit {
    flex: none;
    font-size: var(--text-sm);
    color: var(--text-muted);
}
</style>
