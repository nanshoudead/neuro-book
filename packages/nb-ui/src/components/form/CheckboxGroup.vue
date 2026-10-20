<script setup lang="ts">
import {computed, provide} from "vue";
import {
    CheckboxGroupRoot,
} from "reka-ui";
import Checkbox from "./Checkbox.vue";
import {NB_CHOICE_GROUP_INVALID_KEY, NB_FIELD_CONTEXT_KEY, useFieldContext} from "./field-context";

export interface CheckboxOption {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<{
    modelValue?: string[];
    defaultValue?: string[];
    options?: CheckboxOption[];
    orientation?: "horizontal" | "vertical";
    disabled?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，交互不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
}>(), {
    modelValue: undefined,
    defaultValue: () => [],
    options: () => [],
    orientation: "vertical",
    disabled: false,
    invalid: false,
    readonly: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string[]): void;
}>();

/**
 * 字段的上下文只用在组根：名字、说明与出错都标在组上。组里的复选框看不到它，否则每个都拿到字段的 id、各自标红
 * （docs/specs/ui/forms.md 输出 27）。
 */
const field = useFieldContext();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);
provide(NB_FIELD_CONTEXT_KEY, null);
provide(NB_CHOICE_GROUP_INVALID_KEY, isInvalid);

function isChecked(val: string): boolean {
    const list = props.modelValue ?? props.defaultValue;
    return list.includes(val);
}

function handleToggle(val: string, checked: boolean): void {
    if (props.readonly) return;
    const current = [...(props.modelValue ?? props.defaultValue)];
    const idx = current.indexOf(val);
    if (checked && idx === -1) {
        current.push(val);
    } else if (!checked && idx !== -1) {
        current.splice(idx, 1);
    }
    emit("update:modelValue", current);
}
</script>

<template>
    <CheckboxGroupRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        :disabled="props.disabled"
        :orientation="props.orientation"
        role="group"
        :id="field?.inputId.value"
        :aria-labelledby="field?.labelId.value"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="isInvalid ? 'true' : undefined"
        :aria-readonly="props.readonly || undefined"
        class="flex gap-3 select-none"
        :class="props.orientation === 'horizontal' ? 'flex-row flex-wrap items-center' : 'flex-col'"
        @update:model-value="(val) => emit('update:modelValue', val as string[])"
    >
        <div
            v-for="opt in props.options"
            :key="opt.value"
            class="flex items-start gap-2"
        >
            <Checkbox
                :model-value="isChecked(opt.value)"
                :label="opt.label"
                :description="opt.description"
                :disabled="props.disabled || opt.disabled"
                :readonly="props.readonly"
                @update:model-value="handleToggle(opt.value, $event)"
            />
        </div>
    </CheckboxGroupRoot>
</template>
