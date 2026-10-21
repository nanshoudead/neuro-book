<script setup lang="ts">
import {ref, watch} from "vue";
import {
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";
import {usePopoverLayer} from "../../composables/usePopoverLayer";

const {zIndex: popoverZIndex} = usePopoverLayer();

// 悬停提示：hover 延迟显示、focus 即时显示、click 不打断已显示的提示、Esc 关闭。
// 定位与碰撞翻转交给 reka Popper，不再自己算视口边界。
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

const props = withDefaults(defineProps<{
    /** 提示文本；富内容用 content 插槽覆盖 */
    text?: string;
    placement?: TooltipPlacement;
    /** hover 到显示的延迟毫秒数 */
    delay?: number;
    disabled?: boolean;
}>(), {
    text: "",
    placement: "top",
    delay: 300,
    disabled: false,
});

/*
 * 开合由这里受控：reka 的 `disabled` 只挡住新的悬停，不关已经开着的提示，也不撤悬停时已经排好的延时打开。
 * 点一下触发器把它变成禁用（例如打开了它旁边的面板）时，提示会在延时到点后照样冒出来，压在面板上面接走 Esc。
 */
const open = ref(false);
watch(() => props.disabled, (disabled) => {
    if (disabled) open.value = false;
});

function onOpenChange(value: boolean): void {
    open.value = value && !props.disabled;
}
</script>

<template>
    <TooltipProvider :delay-duration="props.delay">
        <TooltipRoot :open="open" :delay-duration="props.delay" :disabled="props.disabled" :disable-closing-trigger="true" @update:open="onOpenChange">
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal>
                <!-- Tooltip 是轻量说明性浮层：无箭头、对比色胶囊卡片、12px 文字、紧凑适度内边距。
                     通过清晰的 6px 间距声明指向关系，彻底避免三角箭头在复杂投影与描边下的变形与瑕疵。 -->
                <TooltipContent
                    :side="props.placement"
                    :side-offset="6"
                    :style="{zIndex: popoverZIndex}"
                    class="nb-ui-tooltip-surface pointer-events-none w-max max-w-72 outline-none"
                >
                    <span class="block">
                        <slot name="content">{{ props.text }}</slot>
                    </span>
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
