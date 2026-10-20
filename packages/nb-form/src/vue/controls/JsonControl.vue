<script setup lang="ts">
/**
 * JSON 字段（docs/specs/ui/forms.md 输出 1、2、15）：等宽的多行文本框，草稿按 JSON 解析，失焦时提交（回车是换行）。
 * 写坏的草稿不提交，提交失败一次后报“无法解析”。值按字段自己的 schema 由核心校验，问题报在这个字段上。
 */
import {Textarea} from "@notnotype/nb-ui/components";

import {jsonCodec, useDraft} from "../draft";
import {useFormScope} from "../scope";
import type {ControlProps, DraftControl} from "./control";

const props = defineProps<ControlProps>();

const draft = useDraft({
    node: () => props.node,
    value: () => props.modelValue,
    codec: jsonCodec(() => props.node),
    scope: useFormScope(),
});

function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    draft.focused.value = false;
    draft.commit();
}

defineExpose<DraftControl>({commit: draft.commit, reset: draft.reset});
</script>

<template>
    <div class="nb-form-json" @focusin="draft.focused.value = true" @focusout="onFocusOut">
        <Textarea
            :model-value="draft.text.value"
            :rows="props.node.hints.rows ?? 6"
            spellcheck="false"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :invalid="props.invalid"
            @update:model-value="draft.input"
        />
    </div>
</template>

<style scoped>
.nb-form-json {
    min-width: 0;
}

.nb-form-json :deep(textarea) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    tab-size: 2;
}
</style>
