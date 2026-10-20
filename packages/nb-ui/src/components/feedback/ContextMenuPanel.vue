<script setup lang="ts">
import {nextTick, ref, watch} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useMenuCascade} from "../../composables/useMenuCascade";
import {focusPopupItem, usePopupScroll} from "../../composables/usePopupScroll";
import MenuLevelPanel from "../controls/MenuLevelPanel.vue";
import MenuNodes from "../controls/MenuNodes.vue";
import PopupScrollbar from "../layout/PopupScrollbar.vue";
import type {ContextMenuItem} from "./context-menu.types";

const props = defineProps<{
    items: ContextMenuItem[];
    depth: number;
}>();

const emit = defineEmits<{
    (e: "select"): void;
}>();

const cascade = useMenuCascade<ContextMenuItem>();
const scroll = usePopupScroll();

/** 第 `depth` 级（0 为主菜单）滚动了：收起它展开的更深层级，焦点在被收起的层级里时回到展开它的那一项。 */
function collapseBelow(depth: number): void {
    if (cascade.levels.value.length <= depth) return;
    const focusInside = cascade.panels.value.slice(depth).some((panel) => panel?.contains(document.activeElement) === true);
    const level = depth === 0 ? root.value?.querySelector(".nb-menu-level-content") : cascade.panels.value[depth - 1]?.querySelector(".nb-menu-level-content");
    const trigger = level?.querySelector<HTMLElement>(":scope > [aria-expanded='true']") ?? null;
    cascade.truncate(depth);
    if (focusInside) trigger?.focus({preventScroll: true});
}

function onMainScroll(): void {
    scroll.onScroll();
    collapseBelow(0);
}

function selectItem(item: ContextMenuItem): void {
    if (item.disabled || item.children?.length) return;
    item.action?.();
    emit("select");
}
const root = ref<HTMLElement | null>(null);
/** 键盘展开了子菜单：它出现后把焦点放到它的第一项。 */
let focusNewLevel = false;

/** 一级菜单里可用的项，按显示顺序。 */
function itemsIn(container: Element | null): HTMLElement[] {
    return container === null ? [] : [...container.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([disabled])")];
}

/** 键盘：焦点在某一级的项上时在本级移动；焦点停在面板本身（指针离开项后）时，上下键从首末项开始。 */
function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const onPanel = target.getAttribute("role") === "menu";
    const container = onPanel ? target.querySelector(".nb-menu-level-content") : target.closest(".nb-menu-level-content");
    const items = itemsIn(container);
    const index = items.indexOf(target);
    if (index < 0 && !onPanel) return;
    const move = (next: HTMLElement | undefined): void => {
        event.preventDefault();
        focusPopupItem(next);
    };
    switch (event.key) {
        case "ArrowDown":
            move(onPanel ? items[0] : items[(index + 1) % items.length]);
            return;
        case "ArrowUp":
            move(onPanel ? items[items.length - 1] : items[(index - 1 + items.length) % items.length]);
            return;
        case "Home":
            move(items[0]);
            return;
        case "End":
            move(items[items.length - 1]);
            return;
        case "ArrowRight":
            if (target.getAttribute("aria-haspopup") === "menu") focusNewLevel = true;
            return;
        case "ArrowLeft": {
            // 在子菜单里：收起这一级，焦点回到展开它的那一项。
            const level = container?.closest<HTMLElement>("[data-menu-level]");
            if (level === null || level === undefined) return;
            const depth = Number(level.dataset.menuLevel);
            const parent = depth === 0 ? root.value?.querySelector(".nb-menu-level-content") : root.value?.querySelector(`[data-menu-level="${String(depth - 1)}"] .nb-menu-level-content`);
            const trigger = parent?.querySelector<HTMLElement>(":scope > [aria-expanded='true']") ?? null;
            event.preventDefault();
            if (trigger !== null) cascade.schedule(null, trigger, depth, true, false);
            focusPopupItem(trigger);
            return;
        }
    }
}

watch(() => cascade.levels.value.length, async (length, previous) => {
    if (!focusNewLevel || length <= (previous ?? 0)) return;
    focusNewLevel = false;
    await nextTick();
    focusPopupItem(itemsIn(root.value?.querySelector(`[data-menu-level="${String(length - 1)}"] .nb-menu-level-content`) ?? null)[0]);
});
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
        @keydown="onKeydown"
    >
        <!--
            外层只是定位与“算在菜单里”的范围（外部点击按它判断），不画外观：外观层有 backdrop-filter，会成为 fixed 后代的
            包含块，子菜单放在它里面就按它而不是窗口定位。所以主菜单的外观层与各级子菜单是并列的兄弟。
            外层不接收指针（外观层与子菜单各自接收）：它是直角的，外观层是圆角，圆角外那一小块要让给下面的页面，
            例如紧挨着菜单左上角按下去拖标签（真实 Chrome 里退场中的菜单这样接住过按下）。
            （注释写在根元素里面：写在外面组件就成了多根，宿主给的定位样式落不到根上。）
        -->
        <div role="menu" tabindex="-1" class="nb-ui-popover-surface nb-ui-menu-surface pointer-events-auto relative flex outline-none max-h-[calc(100dvh-16px)] min-w-[170px] flex-col overflow-hidden text-[var(--text-main)]">
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
            @scroll="collapseBelow(depth + 1)"
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
