<script setup lang="ts">
/**
 * 单选字段，包括有动态选项的文字字段：横排或竖排单选组、下拉、可搜索的下拉（docs/specs/ui/forms.md 输出 2、11、12）。
 * 选项与它们的状态由字段算好交进来（`choices`），外壳也要用它写“默认：X”与不可用的原因。
 */
import {RadioGroup, SearchSelect, Select} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {optionKey} from "../../options";
import {resolveText} from "../../text";
import type {ChoiceState} from "../choices";
import {messagesFor} from "../messages";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps & {readonly choices: ChoiceState}>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const selectedKey = computed(() => {
    const value = props.modelValue;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? optionKey(value) : "";
});
const options = computed(() => props.choices.items.map((item) => ({
    value: item.key,
    label: item.label,
    ...(item.description === undefined ? {} : {description: item.description}),
    disabled: item.disabled,
})));
const placeholder = computed(() => {
    if (props.choices.status === "loading") return messagesFor(props.locale).loading;
    return resolveText(props.node.hints.placeholder, props.locale);
});

function onSelect(key: string): void {
    const item = props.choices.items.find((entry) => entry.key === key);
    if (item !== undefined && !item.disabled) emit("update:modelValue", item.value);
}
</script>

<template>
    <RadioGroup
        v-if="props.node.widget === 'radio-row' || props.node.widget === 'radio'"
        :orientation="props.node.widget === 'radio-row' ? 'horizontal' : 'vertical'"
        :model-value="selectedKey"
        :options="options"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="onSelect"
    />
    <SearchSelect
        v-else-if="props.node.widget === 'search-select'"
        :model-value="selectedKey"
        :options="options"
        :placeholder="placeholder"
        :empty-text="messagesFor(props.locale).noMatch"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        :aria-busy="props.choices.status === 'loading' || undefined"
        @update:model-value="onSelect"
    />
    <Select
        v-else
        :model-value="selectedKey"
        :options="options"
        :placeholder="placeholder"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        :aria-busy="props.choices.status === 'loading' || undefined"
        @update:model-value="onSelect"
    />
</template>
