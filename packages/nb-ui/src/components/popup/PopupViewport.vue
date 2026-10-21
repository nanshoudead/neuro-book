<script setup lang="ts">
import {watch} from "vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import {usePopupScroll} from "../../composables/usePopupScroll";

/**
 * 弹出列表的滚动视口加悬浮滑块（内部零件），各自持有一份 `usePopupScroll`。要几个视口就放几个零件：Menubar 的每组菜单、
 * 级联的每一级各一个，退场中的旧菜单不会套上新菜单的截断高度与渐隐。外框是定位元素，与视口同一个 offsetParent。
 *
 * `contentKey` 变了（同一个视口换成另一份内容，例如同级子菜单换了父项）时回到顶部：新内容不该接着上一份的滚动位置。
 */
const props = defineProps<{
    contentKey?: unknown;
}>();

const emit = defineEmits<{
    (e: "scroll"): void;
}>();

defineOptions({inheritAttrs: false});

const scroll = usePopupScroll();

watch(() => props.contentKey, () => {
    if (scroll.viewport.value !== null) scroll.viewport.value.scrollTop = 0;
});

function onScroll(): void {
    scroll.onScroll();
    emit("scroll");
}

defineExpose({scroll});
</script>

<template>
    <div v-bind="$attrs" :ref="scroll.setViewport" class="nb-ui-popover-scroll" :class="scroll.fadeClass.value" :style="scroll.viewportStyle.value" @scroll="onScroll">
        <slot />
    </div>
    <PopupScrollbar :scroll="scroll" />
</template>
