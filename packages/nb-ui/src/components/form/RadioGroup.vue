<script setup lang="ts">
import {
    RadioGroupIndicator,
    RadioGroupItem,
    RadioGroupRoot,
} from "reka-ui";
import {computed} from "vue";

import {useFieldContext} from "./field-context";

export interface RadioOption {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

export type RadioGroupSize = "sm" | "md";

const props = withDefaults(defineProps<{
    modelValue?: string;
    defaultValue?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，交互不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
    orientation?: "horizontal" | "vertical";
    size?: RadioGroupSize;
    options?: RadioOption[];
}>(), {
    modelValue: undefined,
    defaultValue: undefined,
    name: undefined,
    disabled: false,
    required: false,
    invalid: false,
    readonly: false,
    orientation: "vertical",
    size: "md",
    options: () => [],
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

/** 组的名字来自字段的标签（`Field` 的组形态，docs/specs/ui/forms.md 输出 27）。 */
const field = useFieldContext();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

/**
 * 只读：值由这里给定（reka 只在没给值时自己记），交出的变化不发出去。方向键仍在选项间移动焦点，选中不动。
 */
const shownValue = computed(() => (props.readonly ? props.modelValue ?? props.defaultValue ?? "" : props.modelValue));
function handleUpdate(value: unknown): void {
    if (props.readonly) return;
    emit("update:modelValue", (value ?? "") as string);
}
</script>

<template>
    <RadioGroupRoot
        :model-value="shownValue"
        :default-value="props.defaultValue"
        :name="props.name"
        :disabled="props.disabled"
        :required="props.required || field?.required.value === true"
        :orientation="props.orientation"
        :id="field?.inputId.value"
        :aria-labelledby="field?.labelId.value"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="isInvalid ? 'true' : undefined"
        :aria-readonly="props.readonly || undefined"
        class="flex"
        :class="props.orientation === 'horizontal' ? 'flex-row flex-wrap gap-4' : 'flex-col gap-2.5'"
        @update:model-value="handleUpdate"
    >
        <template v-if="props.options.length > 0">
            <label
                v-for="option in props.options"
                :key="option.value"
                class="group flex items-start gap-2.5 cursor-pointer select-none"
                :class="[
                    (props.disabled || option.disabled) ? 'cursor-not-allowed opacity-45' : '',
                ]"
            >
                <RadioGroupItem
                    :value="option.value"
                    :disabled="option.disabled"
                    class="nb-ui-focus-ring relative flex shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--text-main)_20%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] transition-[background-color,border-color,transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:border-[var(--accent-main)] group-not-disabled:active:scale-[0.92] disabled:cursor-not-allowed disabled:active:transform-none data-[state=checked]:border-[var(--accent-main)] data-[state=checked]:bg-[var(--accent-main)]"
                    :class="[
                        props.size === 'sm' ? 'h-4 w-4 mt-0.5' : 'h-5 w-5 mt-0.5',
                        isInvalid ? '!border-[color:var(--status-danger)]' : '',
                    ]"
                >
                    <RadioGroupIndicator
                        class="flex items-center justify-center transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                    >
                        <span
                            class="block rounded-full bg-[var(--text-inverse)] shadow-sm"
                            :class="props.size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'"
                        />
                    </RadioGroupIndicator>
                </RadioGroupItem>

                <div class="min-w-0 flex-1">
                    <span
                        class="block font-medium text-[var(--text-main)] leading-snug transition-colors"
                        :class="props.size === 'sm' ? 'text-[length:var(--text-xs)]' : 'text-[length:var(--text-sm)]'"
                    >{{ option.label }}</span>
                    <span
                        v-if="option.description"
                        class="block text-[var(--text-muted)] leading-tight mt-0.5"
                        :class="props.size === 'sm' ? 'text-[length:var(--text-2xs)]' : 'text-[length:var(--text-xs)]'"
                    >{{ option.description }}</span>
                </div>
            </label>
        </template>
        <template v-else>
            <slot />
        </template>
    </RadioGroupRoot>
</template>
