<script setup lang="ts">
import {computed, provide, useId} from "vue";
import {NB_FIELD_CONTEXT_KEY} from "./field-context";

const props = withDefaults(defineProps<{
    label?: string;
    description?: string;
    error?: string;
    for?: string;
    required?: boolean;
}>(), {
    label: "",
    description: "",
    error: "",
    for: "",
    required: false,
});

const generatedId = useId();
const inputId = computed(() => props.for || `nb-field-${generatedId}`);
const descriptionId = computed(() => props.description ? `${inputId.value}-description` : undefined);
const errorId = computed(() => props.error ? `${inputId.value}-error` : undefined);
const ariaDescribedby = computed(() => [errorId.value, descriptionId.value].filter(Boolean).join(" ") || undefined);
const invalid = computed(() => Boolean(props.error));

provide(NB_FIELD_CONTEXT_KEY, {
    inputId,
    descriptionId,
    errorId,
    ariaDescribedby,
    required: computed(() => props.required),
    invalid,
});
</script>

<template>
    <label class="block space-y-1.5" :for="inputId">
        <span v-if="props.label" class="block text-[length:var(--text-sm)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">
            {{ props.label }}<span v-if="props.required" class="ml-1 text-[var(--status-danger)]">*</span>
        </span>
        <slot :input-id="inputId" :description-id="descriptionId" :error-id="errorId" :aria-describedby="ariaDescribedby" :invalid="invalid" />
        <!-- 错误不在字段下插一行字（会让表单重排）：控件标红，原因只给读屏；看得见的原因由宿主写在固定位置（ui-development-spec 的“表单与无障碍”）。 -->
        <span v-if="props.error" :id="errorId" class="sr-only">{{ props.error }}</span>
        <span v-if="props.description" :id="descriptionId" class="block text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ props.description }}</span>
    </label>
</template>
