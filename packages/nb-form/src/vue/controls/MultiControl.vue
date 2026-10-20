<script setup lang="ts">
/** 多选字段：复选组（docs/specs/ui/forms.md 输出 2、12）。值的顺序按选项的顺序，不在选项里的旧值保留在末尾。 */
import {CheckboxGroup} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {optionKey} from "../../options";
import type {ChoiceState} from "../choices";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps & {readonly choices: ChoiceState}>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const selectedKeys = computed(() => selected.value.flatMap((value) => (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [optionKey(value)] : [])));
const options = computed(() => props.choices.items.map((item) => ({
    value: item.key,
    label: item.label,
    ...(item.description === undefined ? {} : {description: item.description}),
    disabled: item.disabled,
})));

function onUpdate(keys: string[]): void {
    const chosen = new Set(keys);
    // 停用项（包括补出来的旧值）用户改不了：它们按原样留在值里。
    const values = props.choices.items.filter((item) => chosen.has(item.key) || (item.disabled && selectedKeys.value.includes(item.key))).map((item) => item.value);
    emit("update:modelValue", values);
}
</script>

<template>
    <CheckboxGroup
        :model-value="selectedKeys"
        :options="options"
        :readonly="props.readonly"
        :disabled="props.disabled"
        :invalid="props.invalid"
        @update:model-value="onUpdate"
    />
</template>
