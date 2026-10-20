<script setup lang="ts">
import {ref, watch} from "vue";
import {MenubarContent, MenubarItem, MenubarMenu, MenubarPortal, MenubarRoot, MenubarTrigger} from "reka-ui";
import MenuLevelPanel from "./MenuLevelPanel.vue";
import MenuNodes from "./MenuNodes.vue";
import PopupScrollbar from "../layout/PopupScrollbar.vue";
import {useMenuCascade} from "../../composables/useMenuCascade";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";

/** 对话框或浮动窗口里的浮层跟随它们的层级（由 Dialog 注入）；不在里面时回退到普通页面层级。 */
const {zIndex: popoverZIndex} = usePopoverLayer();


export interface MenubarItemData {
    label: string;
    value: string;
    shortcut?: string;
    iconClass?: string;
    disabled?: boolean;
    /** 提示与读屏描述（例如禁用原因）；默认不显示。 */
    title?: string;
    tone?: "default" | "danger";
    separator?: boolean;
    checked?: boolean;
    type?: "default" | "checkbox" | "radio";
    children?: MenubarItemData[];
}

export interface MenubarMenuData {
    id: string;
    label: string;
    disabled?: boolean;
    items: MenubarItemData[];
}

const props = withDefaults(defineProps<{
    menus?: MenubarMenuData[];
    size?: "sm" | "md";
    modelValue?: string;
    /** floating：自带外框与模糊的独立菜单条；flat：嵌进标题栏这类已有面的位置，不画外框与模糊。 */
    variant?: "floating" | "flat";
}>(), {
    menus: () => [],
    size: "md",
    modelValue: undefined,
    variant: "floating",
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
    (e: "update:modelValue", value: string): void;
}>();

function handleItemClick(item: MenubarItemData): void {
    if (item.disabled || item.separator) return;
    emit("select", item);
}

/**
 * 打开的顶层菜单变了：转发给宿主（v-model），全部关闭时收起级联面板。reka 的 `MenubarRoot` 把这个事件的类型声明成
 * `boolean`，实际发出的是菜单 id 字符串（关闭时为空串），所以按 unknown 收下再收窄。
 */
function handleOpenMenu(value: unknown): void {
    const open = typeof value === "string" ? value : "";
    openMenu.value = open;
    if (open === "") cascade.reset();
    emit("update:modelValue", open);
}
/** 此刻打开的组（reka 的 modelValue），空串为都没打开；受控时跟着宿主给的值。 */
const openMenu = ref(props.modelValue ?? "");
watch(() => props.modelValue, (value) => {
    if (value !== undefined) openMenu.value = value;
});

/**
 * 菜单内容的“外部点击”“焦点移出”是否要关掉菜单栏。三种情况不关：
 * - 这一组已经关了、只是还在退场动画里：它的外部处理仍挂着，会把紧接着打开的另一组也关掉（真实 Chrome 复现：关掉
 *   “帮助”后立刻点“编辑”，焦点进了“编辑”的菜单内容，退场中的“帮助”把这当成焦点移出，整条菜单栏关掉）；
 * - 指针或焦点进了级联面板：面板在 reka 的菜单内容之外，但属于这个菜单（指针移到面板的项上会把焦点带过去）；
 * - 按在菜单栏的组标题上：组标题自己负责切换。reka 只对焦点做了这个判断，没管指针。
 */
function keepOpen(menuId: string, event: Event): void {
    if (openMenu.value !== menuId) {
        event.preventDefault();
        return;
    }
    const target = event.target as Element | null;
    if (target !== null && cascade.panels.value.some((panel) => panel?.contains(target) === true)) {
        event.preventDefault();
        return;
    }
    // reka 的 MenubarRoot 不一定渲染成单个元素，按角色找组标题：菜单栏里带弹出菜单的那一项。
    if (target?.closest("[role='menubar'] [role='menuitem'][aria-haspopup='menu']") != null) event.preventDefault();
}

const cascade = useMenuCascade<MenubarItemData>();

/**
 * 同一时刻只有一组菜单打开，各组共用一份一级视口的滚动状态。切换组时新一组的内容先挂上、旧一组还在退场动画里，
 * 旧视口卸载时的空 ref 会把新视口清掉，所以只收非空的视口；旧视口的观察在换上新视口时断开。
 */
const scroll = usePopupScroll();
function setMenuViewport(element: unknown): void {
    if (element !== null) scroll.setViewport(element);
}

/** 第 `depth` 级（0 为一级菜单）滚动了：收起它展开的更深层级，焦点在被收起的层级里时回到展开它的那一项。 */
function collapseBelow(depth: number, level: Element | null | undefined): void {
    if (cascade.levels.value.length <= depth) return;
    const focusInside = cascade.panels.value.slice(depth).some((panel) => panel?.contains(document.activeElement) === true);
    const trigger = level?.querySelector<HTMLElement>("[aria-expanded='true']") ?? null;
    cascade.truncate(depth);
    if (focusInside) trigger?.focus({preventScroll: true});
}

function onMenuScroll(event: Event): void {
    scroll.onScroll();
    collapseBelow(0, event.currentTarget as Element | null);
}
function scheduleLevel(item: MenubarItemData | null, trigger: HTMLElement, depth: number, immediate = false): void {
    cascade.schedule(item, trigger, depth, immediate, Boolean(item?.children?.length));
}
</script>

<template>
    <MenubarRoot
        :model-value="props.modelValue"
        class="inline-flex items-center gap-0.5 select-none"
        :class="[props.size === 'sm' ? 'h-[30px]' : 'h-[36px]', props.variant === 'floating' ? 'rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] p-1 backdrop-blur-md shadow-sm' : '']"
        @update:model-value="handleOpenMenu"
    >
        <MenubarMenu
            v-for="menu in props.menus"
            :key="menu.id"
            :value="menu.id"
        >
            <MenubarTrigger
                :disabled="menu.disabled"
                class="nb-ui-focus-ring flex items-center justify-center rounded-[calc(var(--radius-control)*0.75)] font-medium text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                :class="props.size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]'"
            >
                {{ menu.label }}
            </MenubarTrigger>

            <MenubarPortal>
                <MenubarContent
                    :side-offset="6"
                    :align-offset="-4"
                    :style="{zIndex: popoverZIndex}"
                    @pointer-down-outside="(event) => keepOpen(menu.id, event)"
                    @focus-outside="(event) => keepOpen(menu.id, event)"
                    class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative flex max-h-[var(--reka-popper-available-height)] min-w-[200px] flex-col overflow-hidden text-[var(--text-main)] outline-none select-none"
                >
                    <div :ref="setMenuViewport" class="nb-ui-popover-scroll w-full" :class="scroll.fadeClass.value" :style="scroll.viewportStyle.value" @scroll="onMenuScroll">
                        <MenuNodes :items="menu.items" :active="cascade.levels.value[0]?.value" :item-component="MenubarItem" @select="handleItemClick" @hover="(item, trigger, immediate) => scheduleLevel(item, trigger, 0, immediate)" />
                    </div>
                    <PopupScrollbar :scroll="scroll" />
                </MenubarContent>
            </MenubarPortal>
        </MenubarMenu>
        <!--
            级联面板传送到 body，与 reka 的菜单内容同处：留在菜单栏里的话，floating 变体的 backdrop-filter 会成为 fixed 面板的
            包含块，面板按菜单栏而不是窗口定位（真实 Chrome 偏了一百多像素）。
        -->
        <Teleport to="body">
            <MenuLevelPanel
                v-for="(level, depth) in cascade.levels.value"
                :key="depth"
                :ref="(element) => cascade.setPanel(depth, element)"
                :panel-style="{...level.style, zIndex: popoverZIndex + depth + 1}"
                :switching="level.switching"
                @scroll="collapseBelow(depth + 1, cascade.panels.value[depth]?.querySelector('.nb-menu-level-content'))"
            >
                <MenuNodes :items="level.value.children ?? []" :active="cascade.levels.value[depth + 1]?.value" @select="handleItemClick" @hover="(item, trigger, immediate) => scheduleLevel(item, trigger, depth + 1, immediate)" />
            </MenuLevelPanel>
        </Teleport>
    </MenubarRoot>
</template>
