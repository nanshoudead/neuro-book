<script setup lang="ts">
import PopupScrollbar from "../layout/PopupScrollbar.vue";
import {usePopupScroll} from "../../composables/usePopupScroll";

/**
 * 手工级联菜单的一级面板（内部零件），DropdownMenu、Menubar 与右键菜单共用。位置与尺寸由宿主经 `useMenuCascade` 量好
 * 后给出（`measureCascadePanel` 已把高度截到第 9 项中间、夹进窗口）；面板里是这一级自己的滚动视口与滑块。
 *
 * 这一级一滚动就发 `scroll`，宿主收起它展开的更深层级：父项可能已经滚出视口，子菜单不能还挂在原处。
 */
defineProps<{
    panelStyle: Record<string, string | number>;
    switching: boolean;
}>();

const emit = defineEmits<{
    (e: "scroll"): void;
}>();

const scroll = usePopupScroll();

function onScroll(): void {
    scroll.onScroll();
    emit("scroll");
}
</script>

<template>
    <div
        role="menu"
        class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level fixed flex flex-col overflow-hidden"
        :data-switching="switching"
        :style="panelStyle"
    >
        <div :ref="scroll.setViewport" class="nb-ui-popover-scroll nb-menu-level-viewport flex-1" :class="scroll.fadeClass.value" :style="scroll.viewportStyle.value" @scroll="onScroll">
            <div class="nb-menu-level-content">
                <slot />
            </div>
        </div>
        <PopupScrollbar :scroll="scroll" />
    </div>
</template>
