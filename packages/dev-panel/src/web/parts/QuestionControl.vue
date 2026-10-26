<script setup lang="ts">
import {CheckboxGroup, Textarea, RadioGroup} from "@notnotype/nb-ui/components";
import type {VersionQuestion} from "../host/types.js";

/** 一道题的作答控件：单选、多选、确认、文字各一种。答复表单里待答的题与“改答”时用。契约见同名 .md。 */
const props = defineProps<{question: VersionQuestion; modelValue: unknown}>();
const emit = defineEmits<{"update:modelValue": [value: unknown]}>();
const CONFIRM_OPTIONS = [{value: "true", label: "同意"}, {value: "false", label: "不同意"}];
const options = () => props.question.options.map((option) => ({value: option.value, label: props.question.recommend.includes(option.value) ? `${option.label}（推荐）` : option.label}));
</script>

<template>
    <RadioGroup v-if="question.type === 'single'" :model-value="typeof modelValue === 'string' ? modelValue : ''" :options="options()" size="sm" @update:model-value="(value: string) => emit('update:modelValue', value)" />
    <CheckboxGroup v-else-if="question.type === 'multi'" :model-value="Array.isArray(modelValue) ? (modelValue as string[]) : []" :options="options()" @update:model-value="(value: string[]) => emit('update:modelValue', value)" />
    <RadioGroup v-else-if="question.type === 'confirm'" :model-value="modelValue === undefined ? '' : String(modelValue)" :options="CONFIRM_OPTIONS" orientation="horizontal" size="sm" @update:model-value="(value: string) => emit('update:modelValue', value === 'true')" />
    <Textarea v-else :model-value="typeof modelValue === 'string' ? modelValue : ''" :rows="3" :aria-label="question.label" @update:model-value="(value: string) => emit('update:modelValue', value)" />
</template>
