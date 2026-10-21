<script setup lang="ts">
import {ref} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useMenuCascade} from "../../composables/useMenuCascade";
import {usePopupScroll} from "../../composables/usePopupScroll";
import MenuLevelPanel from "./MenuLevelPanel.vue";
import MenuNodes from "./MenuNodes.vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import type {ContextMenuItem} from "./context-menu.types";

const props = defineProps<{
    items: ContextMenuItem[];
    depth: number;
}>();

const emit = defineEmits<{
    (e: "select"): void;
}>();

const root = ref<HTMLElement | null>(null);
/** 第一级是普通按钮，不在 reka 的菜单里：它的上下键、Home、End 也由级联处理。 */
const cascade = useMenuCascade<ContextMenuItem>({rootLevel: () => root.value?.querySelector(".nb-menu-level-content") ?? null, rootRoving: true});
const scroll = usePopupScroll();

function onMainScroll(): void {
    scroll.onScroll();
    cascade.collapseBelow(0);
}

function selectItem(item: ContextMenuItem): void {
    if (item.disabled || item.children?.length) return;
    item.action?.();
    emit("select");
}
</script>

<template>
    <div
        ref="root"
        data-menu-panel
        :data-menu-depth="props.depth"
        class="pointer-events-none fixed"
        :style="{zIndex: NB_Z_INDEX.contextMenu + props.depth}"
        @click.stop
        @contextmenu.prevent
    >
        <!--
            外层只是定位与“算在菜单里”的范围（外部点击按它判断），不画外观：外观层有 backdrop-filter，会成为 fixed 后代的
            包含块，子菜单放在它里面就按它而不是窗口定位。所以主菜单的外观层与各级子菜单是并列的兄弟。
            外层不接收指针（外观层与子菜单各自接收）：它是直角的，外观层是圆角，圆角外那一小块要让给下面的页面，
            例如紧挨着菜单左上角按下去拖标签（真实 Chrome 里退场中的菜单这样接住过按下）。
            （注释写在根元素里面：写在外面组件就成了多根，宿主给的定位样式落不到根上。）
        -->
        <div role="menu" tabindex="-1" class="nb-ui-popover-surface nb-ui-menu-surface pointer-events-auto relative flex outline-none max-h-[calc(100dvh-16px)] min-w-[170px] flex-col overflow-hidden text-[var(--text-main)]" @keydown="cascade.rootKeydown">
            <div :ref="scroll.setViewport" class="nb-ui-popover-scroll w-full" :class="scroll.fadeClass.value" :style="scroll.viewportStyle.value" @scroll="onMainScroll">
                <div class="nb-menu-level-content">
                    <MenuNodes
                        :items="props.items"
                        :active="cascade.levels.value[0]?.value"
                        @select="selectItem"
                        @hover="(item, trigger, immediate) => cascade.schedule(item, trigger, 0, immediate, Boolean(item?.children?.length))"
                    />
                </div>
            </div>
            <PopupScrollbar :scroll="scroll" />
        </div>
        <MenuLevelPanel
            v-for="(level, depth) in cascade.levels.value"
            :key="depth"
            :ref="(element) => cascade.setPanel(depth, element)"
            :data-menu-level="depth"
            :panel-style="{...level.style, zIndex: NB_Z_INDEX.contextMenu + props.depth + depth + 1}"
            :switching="level.switching"
            :content-key="level.value"
            @keydown="(event: KeyboardEvent) => cascade.levelKeydown(depth, event)"
            @scroll="cascade.collapseBelow(depth + 1)"
        >
            <MenuNodes
                :items="level.value.children ?? []"
                :active="cascade.levels.value[depth + 1]?.value"
                @select="selectItem"
                @hover="(item, trigger, immediate) => cascade.schedule(item, trigger, depth + 1, immediate, Boolean(item?.children?.length))"
            />
        </MenuLevelPanel>
    </div>
</template>
