<script setup lang="ts">
/** 布尔字段：开关，或 `confirm` 的“是 / 否”单选组（docs/specs/ui/forms.md 输出 2、4）。 */
import {RadioGroup, Switch} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {optionKey, optionValue} from "../../options";
import {messagesFor} from "../messages";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

/** 缺值的开关显示 `default` 的状态（外壳另标“默认”）；没有默认时显示为关。 */
const switchValue = computed(() => (typeof props.modelValue === "boolean" ? props.modelValue : props.node.schema.default === true));
/** “是 / 否”在未答时什么也不选：未答是缺值，不是“否”。 */
const confirmKey = computed(() => (typeof props.modelValue === "boolean" ? optionKey(props.modelValue) : ""));
const confirmOptions = computed(() => {
    const messages = messagesFor(props.locale);
    return [{value: optionKey(true), label: messages.yes}, {value: optionKey(false), label: messages.no}];
});

function onConfirm(key: string): void {
    const value = optionValue(key, [true, false]);
    if (value !== undefined) emit("update:modelValue", value);
}
</script>

<template>
    <RadioGroup
        v-if="props.widget === 'confirm'"
        orientation="horizontal"
        :model-value="confirmKey"
        :options="confirmOptions"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="onConfirm"
    />
    <Switch
        v-else
        :model-value="switchValue"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    />
</template>
