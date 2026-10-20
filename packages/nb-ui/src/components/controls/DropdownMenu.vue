<script setup lang="ts">
import {computed, nextTick, provide, ref, watch} from "vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import MenuNodes from "./MenuNodes.vue";
import {useDropdownFloating} from "../../composables/useDropdownFloating";
import {useMenuCascade} from "../../composables/useMenuCascade";
import type {DropdownMenuItemData} from "./dropdown-menu.types";
/**
 * 下拉菜单（DropdownMenu · 规范化黄金 Surface、同心圆角与 N.5 齐腰截半露底视口）。
 *
 * 浮层接入 `useDropdownFloating` 单一真相源，
 * 严格对齐 Select 黄金微反光立体投影与 130% 饱和滤波，
 * 支持 4px 悬浮 macOS 胶囊滚动条与自适应双向渐隐。
 *
 * 结构覆盖平面项、分隔线、任意层级子菜单与受控 radio / checkbox；
 * 一级菜单的键盘漫游（上下键、Home、End、首字母、跳过禁用项）与关闭后焦点归还由 Reka 菜单原语承担。级联面板是手工
 * 画的（在 Reka 的菜单内容之外，接不到它的菜单上下文）：键盘漫游、展开与收起由这里处理，面板里的指针与焦点也不算
 * “点了外部”，否则按下指针时菜单先关、点击落空。
 */

const props = withDefaults(defineProps<{
    items: DropdownMenuItemData[];
    menuClass?: string;
    rootClass?: string;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    disabled?: boolean;
    popoverStyle?: Record<string, string | number>;
    /** 受控展开态：传了由宿主决定，不传由原语自管；两种用法都会发 update:open。 */
    open?: boolean;
    /** 浮层内容原生属性透传（用于 data-xxx 等属性） */
    contentProps?: Record<string, unknown>;
    /** 条目文字允许换行：菜单最宽 320px，长文字完整显示；缺省单行截断。 */
    wrap?: boolean;
}>(), {
    menuClass: undefined,
    rootClass: "",
    align: "start",
    side: "bottom",
    sideOffset: 7,
    disabled: false,
    // 显式 undefined 默认值：Boolean 档缺省会被 Vue 转成 false，那样就永远拿不到「未受控」这一档
    open: undefined,
    contentProps: () => ({}),
    wrap: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
    (e: "focus", event: FocusEvent): void;
    (e: "update:open", value: boolean): void;
}>();

/** 非受控时由这里持有展开态：级联面板里选中一项后要能把整个菜单关掉（那不是 Reka 的菜单项，它不会自己关）。 */
const ownOpen = ref(false);
const isOpen = computed(() => props.open ?? ownOpen.value);

function handleOpenChange(value: boolean): void {
    if (!value) cascade.reset();
    ownOpen.value = value;
    emit("update:open", value);
}

/** 子菜单父项不走这里：它只展开子菜单，不执行自己的动作。 */
function handleSelect(item: DropdownMenuItemData): void {
    if (item.disabled) return;
    emit("select", item.value);
}

/** 级联面板里的选中：执行后关掉整个菜单，焦点由 Reka 还给触发器。 */
function handleCascadeSelect(item: DropdownMenuItemData): void {
    if (item.disabled) return;
    handleSelect(item);
    handleOpenChange(false);
}

/** 指针或焦点进了级联面板：在 Reka 看来是菜单内容之外，但它属于这个菜单。 */
function keepOpenForCascade(event: Event): void {
    const target = (event as CustomEvent<{originalEvent?: Event}>).detail?.originalEvent?.target ?? event.target;
    if (target instanceof Node && cascade.panels.value.some((panel) => panel?.contains(target) === true)) event.preventDefault();
}

/** 一级里可用的项，按显示顺序。 */
function itemsIn(container: Element | null | undefined): HTMLElement[] {
    return container === null || container === undefined ? [] : [...container.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([disabled])")];
}

/** 键盘展开了子菜单：它出现后把焦点放到它的第一项。 */
let focusNewLevel = false;

/** 一级菜单（Reka 内容）里，键盘在父项上展开子菜单（右方向键、Enter、空格）：焦点跟进新的一级。 */
function onContentKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.getAttribute("aria-haspopup") === "menu" && ["ArrowRight", "Enter", " "].includes(event.key)) focusNewLevel = true;
}

/** 级联面板里的键盘：上下、Home、End 在本级可用项之间移动；右方向键展开；左方向键收起本级、回到展开它的那一项。 */
function onLevelKeydown(depth: number, event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const items = itemsIn(cascade.panels.value[depth]?.querySelector(".nb-menu-level-content"));
    const index = items.indexOf(target);
    if (index < 0) return;
    const move = (next: HTMLElement | undefined): void => {
        event.preventDefault();
        next?.focus();
    };
    switch (event.key) {
        case "ArrowDown":
            move(items[(index + 1) % items.length]);
            return;
        case "ArrowUp":
            move(items[(index - 1 + items.length) % items.length]);
            return;
        case "Home":
            move(items[0]);
            return;
        case "End":
            move(items[items.length - 1]);
            return;
        case "ArrowRight":
        case "Enter":
        case " ":
            if (target.getAttribute("aria-haspopup") === "menu") focusNewLevel = true;
            return;
        case "ArrowLeft": {
            const parent = depth === 0 ? contentEl.value : cascade.panels.value[depth - 1]?.querySelector(".nb-menu-level-content");
            const trigger = parent?.querySelector<HTMLElement>("[aria-expanded='true']") ?? null;
            event.preventDefault();
            if (trigger !== null) cascade.schedule(null, trigger, depth, true, false);
            trigger?.focus();
            return;
        }
    }
}

const contentEl = ref<HTMLElement | null>(null);
function setContentRef(element: unknown): void {
    const node = element && typeof element === "object" && "$el" in element ? (element as {$el?: unknown}).$el : element;
    contentEl.value = node instanceof HTMLElement ? node : null;
}


const triggerRef = ref<HTMLElement | null>(null);
function setTriggerRef(element: unknown): void {
    const node = element && typeof element === "object" && "$el" in element ? (element as { $el?: HTMLElement }).$el : element;
    triggerRef.value = node && typeof node === "object" && "getBoundingClientRect" in node ? (node as HTMLElement) : null;
}
const unscaledAnchor = computed(() => {
    const trigger = triggerRef.value;
    if (!trigger || !("getBoundingClientRect" in trigger)) return undefined;
    return {getBoundingClientRect: () => unscaledRect(trigger)};
});

function unscaledRect(element: HTMLElement): DOMRect {
    const rect = element.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(element).transform).a || 1;
    if (scale === 1) return rect;
    const width = rect.width / scale;
    const height = rect.height / scale;
    return new DOMRect(rect.left - (width - rect.width) / 2, rect.top - (height - rect.height) / 2, width, height);
}
// 统一浮层材质、同心律视口、黄金截半高度与 macOS 悬浮滚动条单一真相源
const {
    popoverStyle: floatingPopoverStyle,
    popoverClasses,
    setViewportRef,
    viewportStyle,
    viewportClasses,
    handleViewportScroll,
    handleThumbMouseDown,
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
} = useDropdownFloating({
    sideOffset: computed(() => props.sideOffset),
    popoverStyle: computed(() => props.popoverStyle),
});
const resolvedMenuClass = computed(() => [props.menuClass ?? "min-w-[160px]", props.wrap ? "max-w-[320px]" : ""]);


const cascade = useMenuCascade<DropdownMenuItemData>();
function warnMissingRadioGroup(items: readonly DropdownMenuItemData[]): void {
    for (const item of items) {
        if (item.type === "radio" && item.group === undefined) console.warn(`[nb-ui/DropdownMenu] radio 项「${item.value}」缺少 group，已按单项独立成组渲染。`);
        if (item.children) warnMissingRadioGroup(item.children);
    }
}
warnMissingRadioGroup(props.items);
function scheduleSubmenu(item: DropdownMenuItemData | null, trigger: HTMLElement, depth = 0, immediate = false): void {
    cascade.schedule(item, trigger, depth, immediate, Boolean(item?.children?.length));
}

watch(() => cascade.levels.value.length, async (length, previous) => {
    if (!focusNewLevel || length <= (previous ?? 0)) return;
    focusNewLevel = false;
    await nextTick();
    itemsIn(cascade.panels.value[length - 1]?.querySelector(".nb-menu-level-content"))[0]?.focus();
});
</script>

<template>
    <DropdownMenuRoot :modal="false" :open="isOpen" @update:open="handleOpenChange">
        <DropdownMenuTrigger :ref="setTriggerRef" as-child :disabled="props.disabled" :class="props.rootClass">
            <slot />
        </DropdownMenuTrigger>

        <DropdownMenuPortal v-if="props.open === undefined || props.open">
            <DropdownMenuContent
                :ref="setContentRef"
                position="popper"
                :reference="unscaledAnchor"
                :align="props.align"
                :side="props.side"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :collision-padding="8"
                :class="[popoverClasses, resolvedMenuClass]"
                v-bind="props.contentProps"
                @interact-outside="keepOpenForCascade"
                @keydown.capture="onContentKeydown"
            >
                <!-- 滚动视口（自适应双向渐隐 + 隐藏原生滚动条） -->
                <div
                    :ref="setViewportRef"
                    class="clean-dropdown-viewport w-full"
                    :class="[viewportClasses, isScrollable ? 'pr-1.5' : '']"
                    :style="viewportStyle"
                    @scroll="handleViewportScroll"

                >
                    <MenuNodes
                        :items="props.items"
                        :active="cascade.levels.value[0]?.value"
                        :item-component="DropdownMenuItem"
                        :wrap="props.wrap"
                        @select="handleSelect"
                        @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, 0, immediate)"
                    >
                        <template #item="slotProps"><slot name="item" v-bind="slotProps" /></template>
                        <template #item-right="slotProps"><slot name="item-right" v-bind="slotProps" /></template>
                    </MenuNodes>
                </div>

                <!-- 100% 绝对可见、100% 鼠标完全可按住拖拽的 macOS 4px 悬浮胶囊滑块 -->
                <div
                    v-if="isScrollable"
                    class="absolute right-[3px] top-1.5 bottom-1.5 w-1 z-20 flex flex-col justify-start"
                >
                    <div
                        class="w-1 rounded-full cursor-pointer transition-colors"
                        :class="isDragging ? 'bg-[color-mix(in_srgb,var(--text-main)_75%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-main)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_70%,transparent)]'"
                        :style="{
                            height: `${scrollThumbHeight}px`,
                            transform: `translateY(${scrollThumbTop}px)`,
                        }"
                        @mousedown="handleThumbMouseDown"
                    ></div>
                </div>
            </DropdownMenuContent>
            <div
                v-for="(level, depth) in cascade.levels.value"
                :key="depth"
                :ref="(element) => cascade.setPanel(depth, element)"
                role="menu"
                class="nb-ui-popover-surface nb-ui-menu-surface nb-menu-level fixed overflow-hidden"
                :data-switching="level.switching"
                :style="level.style"
                @keydown="(event: KeyboardEvent) => onLevelKeydown(depth, event)"
            >
                <div class="nb-menu-level-content">
                    <MenuNodes :items="level.value.children ?? []" :active="cascade.levels.value[depth + 1]?.value" :wrap="props.wrap" @select="handleCascadeSelect" @hover="(item, trigger, immediate) => scheduleSubmenu(item, trigger, depth + 1, immediate)" />
                </div>
            </div>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>

<style scoped>
.clean-dropdown-viewport {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.clean-dropdown-viewport::-webkit-scrollbar {
    display: none;
}
</style>
