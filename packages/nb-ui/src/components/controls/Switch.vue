<script setup lang="ts">
import {
    SwitchRoot,
    SwitchThumb,
} from "reka-ui";
import {computed} from "vue";

import {useFieldContext} from "../form/field-context";

export type SwitchSize = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{
    modelValue?: boolean;
    defaultValue?: boolean;
    disabled?: boolean;
    size?: SwitchSize;
    name?: string;
    ariaLabel?: string;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文的出错取或。 */
    invalid?: boolean;
    /** 只读：可以聚焦、写 `aria-readonly`，交互不改值（docs/specs/ui/forms.md 输出 28）。 */
    readonly?: boolean;
}>(), {
    modelValue: undefined,
    defaultValue: false,
    disabled: false,
    size: "md",
    name: undefined,
    // 没有缺省名称：缺省的“开关”会盖过字段标签。名字来自 `Field` 的标签（经上下文的 id 与 `<label for>`）或调用方。
    ariaLabel: undefined,
    invalid: false,
    readonly: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const field = useFieldContext();
const isInvalid = computed(() => props.invalid || field?.invalid.value === true);

/** 只读：值由这里给定（reka 只在没给值时自己记），切换不发出去。 */
const shownValue = computed(() => (props.readonly ? props.modelValue ?? props.defaultValue : props.modelValue));
function handleUpdate(value: boolean): void {
    if (!props.readonly) emit("update:modelValue", value);
}
</script>

<template>
    <SwitchRoot
        :model-value="shownValue"
        :default-value="props.defaultValue"
        :disabled="props.disabled"
        :name="props.name"
        :id="field?.inputId.value"
        :aria-label="props.ariaLabel"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="isInvalid ? 'true' : undefined"
        :aria-readonly="props.readonly || undefined"
        class="nb-ui-focus-ring relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 bg-[color-mix(in_srgb,var(--text-main)_16%,transparent)] data-[state=checked]:bg-[var(--accent-main)]"
        :class="[
            // 内边距必须与那 1px 透明边框（焦点环靠它上色）一起算：内容高 = 轨道高 − 2×边框 − 2×内边距。
            // `p-0.5` 会让 md 的内容区只剩 14px，装不下 16px 的滑块——滑块会从轨道右上角溢出去。
            props.size === 'sm' ? 'h-4 w-7 p-px' : '',
            props.size === 'md' ? 'h-5 w-9 p-px' : '',
            props.size === 'lg' ? 'h-6 w-11 p-px' : '',
            // 出错时借那 1px 透明边框描红，尺寸不变。
            isInvalid ? '!border-[color:var(--status-danger)]' : '',
        ]"
        @update:model-value="handleUpdate"
    >
        <SwitchThumb
            class="pointer-events-none block rounded-full bg-[var(--text-inverse)] shadow-[0_1px_2px_color-mix(in_srgb,var(--shadow-color)_25%,transparent)] transition-transform [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] will-change-transform translate-x-0"
            :class="[
                props.size === 'sm' ? 'h-3 w-3 data-[state=checked]:translate-x-3' : '',
                props.size === 'md' ? 'h-4 w-4 data-[state=checked]:translate-x-4' : '',
                props.size === 'lg' ? 'h-5 w-5 data-[state=checked]:translate-x-5' : '',
            ]"
        />
    </SwitchRoot>
</template>
