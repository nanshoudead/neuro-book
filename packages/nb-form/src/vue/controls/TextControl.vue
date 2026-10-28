<script setup lang="ts">
/**
 * 文字字段：单行、多行，以及密钥（`SecretInput` 做好之前按单行画，docs/specs/ui/forms.md 输出 31）。输入先进草稿，
 * 按提交时机提交（输出 15）：`change` 时失焦或回车（多行里回车是换行，只在失焦时）。
 */
import {Input, Textarea} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {TEXT_CODEC, useDraft} from "../draft";
import {useFormScope} from "../scope";
import {useFormText} from "../text";
import {defaultPlaceholder} from "./placeholder";
import type {ControlProps, DraftControl} from "./control";

const props = defineProps<ControlProps>();
const text = useFormText();

const draft = useDraft({
    node: () => props.node,
    value: () => props.modelValue,
    codec: TEXT_CODEC,
    scope: useFormScope(),
});

const placeholder = computed(() => (props.modelValue === undefined ? defaultPlaceholder(props.node, text) : undefined) ?? text.text(props.node.hints.placeholder));
const minLength = computed(() => (typeof props.node.schema.minLength === "number" ? props.node.schema.minLength : undefined));
const maxLength = computed(() => (typeof props.node.schema.maxLength === "number" ? props.node.schema.maxLength : undefined));
/** 只换软键盘，不用原生的 email、url 类型：格式由 schema 校验，原生校验的提示文字与表单的问题显示不一致。 */
const inputmode = computed(() => (props.node.schema.format === "email" ? "email" : props.node.schema.format === "uri" ? "url" : undefined));

function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    draft.focused.value = false;
    draft.commit();
}

/** 回车提交，并阻止默认动作：表单放在调用方的 `<form>` 里时回车不隐式提交（输出 21）。组字中的回车交给输入法。 */
function onEnter(event: KeyboardEvent): void {
    if (event.isComposing) return;
    event.preventDefault();
    draft.commit();
}

defineExpose<DraftControl>({commit: draft.commit, reset: draft.reset});
</script>

<template>
    <div class="nb-form-text" @focusin="draft.focused.value = true" @focusout="onFocusOut">
        <Textarea
            v-if="props.widget === 'multiline'"
            :model-value="draft.text.value"
            :rows="props.node.hints.rows ?? 4"
            :placeholder="placeholder"
            :minlength="minLength"
            :maxlength="maxLength"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :invalid="props.invalid"
            @update:model-value="draft.input"
        />
        <Input
            v-else
            :inputmode="inputmode"
            :model-value="draft.text.value"
            :placeholder="placeholder"
            :minlength="minLength"
            :maxlength="maxLength"
            :autocomplete="props.widget === 'secret' ? 'off' : undefined"
            :clear-label="text.t('clearInput')"
            :readonly="props.readonly"
            :disabled="props.disabled"
            :invalid="props.invalid"
            @update:model-value="draft.input"
            @keydown.enter="onEnter"
        />
    </div>
</template>

<style scoped>
.nb-form-text {
    min-width: 0;
}
</style>
