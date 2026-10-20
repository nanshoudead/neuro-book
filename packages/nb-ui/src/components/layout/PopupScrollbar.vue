<script setup lang="ts">
import type {PopupScroll} from "../../composables/usePopupScroll";

/**
 * 弹出列表的悬浮滑块（内部零件，不从包入口导出）。轨道的位置与长度、滑块的位置与长度都由 `usePopupScroll` 给出，
 * 这里只负责画出来、把按下交回去。外框必须是定位元素（滑块按它绝对定位），并且与视口是同一个 offsetParent。
 */
defineProps<{
    scroll: PopupScroll;
}>();
</script>

<template>
    <div
        v-if="scroll.scrollable.value"
        class="pointer-events-none absolute right-[3px] z-20 w-1"
        :style="{top: `${scroll.trackTop.value}px`, height: `${scroll.trackHeight.value}px`}"
        aria-hidden="true"
        data-popup-scrollbar
    >
        <div
            class="pointer-events-auto w-1 cursor-pointer rounded-full transition-colors [transition-duration:var(--motion-fast)]"
            :class="scroll.dragging.value ? 'bg-[color-mix(in_srgb,var(--text-main)_75%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-main)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_70%,transparent)]'"
            :style="{height: `${scroll.thumbHeight.value}px`, transform: `translateY(${scroll.thumbTop.value}px)`}"
            data-popup-scrollbar-thumb
            @pointerdown="scroll.startDrag"
        ></div>
    </div>
</template>
