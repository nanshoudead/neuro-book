<script setup lang="ts">
import {computed, getCurrentInstance, useSlots} from "vue";
import Dialog from "./Dialog.vue";

/**
 * 旧的浮动窗口名字。
 *
 * Dialog 合并了窗口能力之后，缺省变成模态框，并且会画出确认页脚、默认不显示关闭按钮。
 * 旧调用仍按「非模态、可关、没有确认按钮、sm/md/lg 三档尺寸」来写，所以这层只把那些默认值补回去。
 */
const WINDOW_SIZE = {
    sm: {width: 420, height: 420},
    md: {width: 720, height: 640},
    lg: {width: 1100, height: 820},
} as const;

const props = withDefaults(defineProps<{
    modelValue: boolean;
    size?: keyof typeof WINDOW_SIZE;
    title?: string;
    width?: number;
    height?: string | number;
    maxHeight?: string;
    resizable?: boolean;
    minWidth?: number;
    minHeight?: number;
    closable?: boolean;
    closeOnEsc?: boolean;
    busy?: boolean;
    bodyClass?: string;
    teleportTarget?: string | boolean;
}>(), {
    size: "md",
    title: "",
    width: undefined,
    height: undefined,
    maxHeight: "calc(100cqh - 80px)",
    resizable: false,
    minWidth: 320,
    minHeight: 240,
    closable: true,
    closeOnEsc: true,
    busy: false,
    bodyClass: "overflow-y-auto px-4 py-3",
    teleportTarget: undefined,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "request-close", reason: "close-button" | "esc"): void;
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const instance = getCurrentInstance();
const slots = useSlots();
const preset = computed(() => WINDOW_SIZE[props.size]);
const width = computed(() => props.width ?? preset.value.width);
const height = computed(() => props.height ?? preset.value.height);
const hasRequestCloseListener = computed(() => Boolean(instance?.vnode.props && "onRequestClose" in instance.vnode.props));

function onRequestClose(reason: "overlay" | "cancel" | "close-button" | "esc"): void {
    if (reason !== "close-button" && reason !== "esc") {
        return;
    }
    emit("request-close", reason);
    if (!hasRequestCloseListener.value) {
        emit("update:modelValue", false);
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        :modal="false"
        size="lg"
        :title="props.title"
        :width="width"
        :height="height"
        :max-height="props.maxHeight"
        :resizable="props.resizable"
        :min-width="props.minWidth"
        :min-height="props.minHeight"
        :closable="props.closable"
        :close-on-esc="props.closeOnEsc"
        :busy="props.busy"
        :body-class="props.bodyClass"
        :teleport-target="props.teleportTarget"
        :show-footer="Boolean(slots.footer)"
        show-header
        @update:model-value="emit('update:modelValue', $event)"
        @request-close="onRequestClose"
        @update:width="emit('update:width', $event)"
        @update:height="emit('update:height', $event)"
    >
        <template v-if="slots.header" #header>
            <slot name="header" />
        </template>
        <slot />
        <template v-if="slots.footer" #footer="slotProps">
            <slot name="footer" v-bind="slotProps ?? {}" />
        </template>
    </Dialog>
</template>
