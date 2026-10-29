<script setup lang="ts">
/**
 * 单选字段，包括有动态选项的文字字段：分段控件、横排或竖排单选组、下拉、可搜索的下拉（docs/specs/ui/forms.md 输出 2、11、12）。
 * 选项与它们的状态由字段算好交进来（`choices`），外壳也要用它写“默认：X”与不可用的原因。
 */
import {RadioGroup, SearchSelect, SegmentedControl, Select} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {optionKey} from "../../options";
import type {ChoiceState} from "../choices";
import {useFormText} from "../text";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps & {readonly choices: ChoiceState}>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();
const text = useFormText();

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
    if (props.choices.status === "loading") return text.t("loading");
    return text.text(props.node.hints.placeholder);
});

function onSelect(key: string): void {
    const item = props.choices.items.find((entry) => entry.key === key);
    if (item !== undefined && !item.disabled) emit("update:modelValue", item.value);
}
</script>

<template>
    <SegmentedControl
        v-if="props.widget === 'segmented'"
        :model-value="selectedKey"
        :options="options"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="(key: SegmentedControlValue) => onSelect(String(key))"
    />
    <RadioGroup
        v-else-if="props.widget === 'radio-row' || props.widget === 'radio'"
        :orientation="props.widget === 'radio-row' ? 'horizontal' : 'vertical'"
        :model-value="selectedKey"
        :options="options"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="onSelect"
    />
    <SearchSelect
        v-else-if="props.widget === 'search-select'"
        :model-value="selectedKey"
        :options="options"
        :placeholder="placeholder"
        :empty-text="text.t('noMatch')"
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
