<script setup lang="ts">
import SegmentedControl from "nbook/app/components/common/form/SegmentedControl.vue";
import type {SegmentedControlValue} from "nbook/app/components/common/form/SegmentedControl.vue";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: null,
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

function updateValue(value: SegmentedControlValue): void {
    emit("update:modelValue", value);
}
</script>

<template>
    <SegmentedControl
        :model-value="props.modelValue as SegmentedControlValue"
        :options="props.field.options.map((option) => ({...option, disabled: props.disabled || option.disabled}))"
        @update:model-value="updateValue"
    />
</template>
