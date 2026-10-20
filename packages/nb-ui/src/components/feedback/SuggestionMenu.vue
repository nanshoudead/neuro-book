<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";
import {PopoverContent, PopoverPortal, PopoverRoot} from "reka-ui";
import Spinner from "../display/Spinner.vue";
import PopupScrollbar from "../layout/PopupScrollbar.vue";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";
import {toPopoverReference} from "./popover-anchor";
import {suggestionOptionId, type SuggestionMenuAnchor, type SuggestionMenuGroup, type SuggestionMenuItem, type SuggestionMenuPlacement} from "./suggestion-menu";

/**
 * 输入时弹出的候选菜单，焦点留在输入处（行为见同名 `.md`）。
 *
 * 定位走 reka 的 Popover 原语，与 DropdownMenu 同一套：传送、层级、碰撞夹紧，以及 `--reka-popper-available-*`
 * 给外框收矮、收窄。锚点一律换成虚拟锚点并逐帧更新（`updatePositionStrategy: "always"`）：光标的矩形在同一个
 * 输入框里变化时，floating-ui 的 autoUpdate 观察不到任何元素变化，只有逐帧读才跟得上。
 */
const props = withDefaults(defineProps<{
    groups: readonly SuggestionMenuGroup[];
    activeId: string | null;
    anchor?: SuggestionMenuAnchor | null;
    id?: string;
    label?: string;
    loading?: boolean;
    loadingText?: string;
    emptyText?: string;
    placement?: SuggestionMenuPlacement;
    matchAnchorWidth?: boolean;
    sideOffset?: number;
    teleportTarget?: string;
}>(), {
    anchor: null,
    id: undefined,
    label: undefined,
    loading: false,
    loadingText: "",
    emptyText: "",
    placement: "auto",
    matchAnchorWidth: false,
    sideOffset: 6,
    teleportTarget: undefined,
});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "highlight", id: string): void;
}>();

defineSlots<{
    header?: () => unknown;
}>();

/** 夹进窗口时四边留的距离，与可用空间的计算是同一个数。 */
const COLLISION_PADDING = 12;
/** `placement: "auto"` 时偏好的下方至少要有这么高，否则上方更宽就翻上去。 */
const MIN_SIDE_SPACE = 96;

const generatedId = useId();
const menuId = computed(() => props.id ?? `nb-suggestion-${generatedId}`);
const {zIndex} = usePopoverLayer();
const scroll = usePopupScroll();

const reference = computed(() => toPopoverReference(props.anchor));

/** 渲染用的分组：给每个可选项排上跨组累计的下标，与 `suggestionMenuOptions` 的顺序一致。 */
const rendered = computed(() => {
    let index = 0;
    return props.groups.map((group) => ({
        id: group.id,
        label: group.label,
        labelId: `${menuId.value}-group-${group.id}`,
        rows: group.items.map((item) => ({item, domId: item.disabled === true ? undefined : suggestionOptionId(menuId.value, index++)})),
    }));
});
const empty = computed(() => !props.loading && props.groups.every((group) => group.items.length === 0));

function isActive(item: SuggestionMenuItem): boolean {
    return item.disabled !== true && item.id === props.activeId;
}

function onPointermove(item: SuggestionMenuItem): void {
    if (item.disabled === true || item.id === props.activeId) return;
    emit("highlight", item.id);
}

function onClick(item: SuggestionMenuItem): void {
    if (item.disabled !== true) emit("select", item.id);
}

watch(() => props.activeId, async () => {
    await nextTick();
    const row = rendered.value.flatMap((group) => group.rows).find((entry) => isActive(entry.item));
    if (row?.domId !== undefined) scroll.reveal(document.getElementById(row.domId));
});

/*
 * `placement: "auto"`：每帧按锚点上下的剩余空间选一侧。不交给 floating-ui 的 flip：flip 在整个菜单放不下时就翻，
 * 而这里要的是“下方还有 96px 就留在下方、由外框收矮”，翻转的门槛与菜单多高无关。
 */
const autoSide = ref<"top" | "bottom">("bottom");
let sideFrame: number | null = null;

function trackSide(): void {
    const anchor = reference.value;
    if (anchor === undefined) {
        sideFrame = null;
        return;
    }
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - props.sideOffset - COLLISION_PADDING;
    const above = rect.top - props.sideOffset - COLLISION_PADDING;
    const next = below >= MIN_SIDE_SPACE || below >= above ? "bottom" : "top";
    if (next !== autoSide.value) autoSide.value = next;
    sideFrame = requestAnimationFrame(trackSide);
}

function stopTrackingSide(): void {
    if (sideFrame !== null) cancelAnimationFrame(sideFrame);
    sideFrame = null;
}

watch(() => [reference.value, props.placement] as const, ([anchor, placement]) => {
    stopTrackingSide();
    if (anchor !== undefined && placement === "auto") trackSide();
}, {immediate: true});
onBeforeUnmount(stopTrackingSide);

const side = computed(() => (props.placement === "auto" ? autoSide.value : props.placement));

const widthClass = computed(() => (props.matchAnchorWidth
    ? "w-[min(var(--reka-popper-anchor-width),var(--reka-popper-available-width))]"
    : "w-max min-w-[min(220px,var(--reka-popper-available-width))] max-w-[min(420px,var(--reka-popper-available-width))]"));

defineExpose({
    /** 节点是否在浮层里（浮层传送出去了，不在宿主的 DOM 里）。 */
    contains(node: Node | null): boolean {
        const surface = scroll.viewport.value?.closest("[data-suggestion-menu]");
        return node !== null && surface !== null && surface !== undefined && surface.contains(node);
    },
});
</script>

<template>
    <PopoverRoot :open="reference !== undefined" :modal="false">
        <PopoverPortal :to="props.teleportTarget ?? 'body'">
            <PopoverContent
                :reference="reference"
                :side="side"
                align="start"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :side-flip="false"
                :collision-padding="COLLISION_PADDING"
                sticky="always"
                update-position-strategy="always"
                class="nb-ui-popover-surface nb-ui-menu-surface relative flex max-h-[var(--reka-popper-available-height)] flex-col overflow-hidden text-[var(--text-main)] outline-none"
                :class="widthClass"
                :style="{zIndex}"
                data-suggestion-menu
                @open-auto-focus.prevent
                @close-auto-focus.prevent
                @escape-key-down.prevent
                @pointer-down-outside.prevent
                @focus-outside.prevent
                @interact-outside.prevent
            >
                <div v-if="$slots.header" class="shrink-0" data-suggestion-menu-header>
                    <slot name="header" />
                </div>
                <div
                    :id="menuId"
                    :ref="scroll.setViewport"
                    role="listbox"
                    :aria-label="props.label"
                    class="nb-ui-popover-scroll w-full"
                    :class="scroll.fadeClass.value"
                    :style="scroll.viewportStyle.value"
                    @scroll="scroll.onScroll"
                    @mousedown.prevent
                >
                    <div
                        v-for="group in rendered"
                        :key="group.id"
                        :role="group.label === undefined ? 'presentation' : 'group'"
                        :aria-labelledby="group.label === undefined ? undefined : group.labelId"
                    >
                        <div v-if="group.label !== undefined" :id="group.labelId" class="nb-ui-menu-label">{{ group.label }}</div>
                        <div
                            v-for="row in group.rows"
                            :id="row.domId"
                            :key="row.item.id"
                            role="option"
                            class="nb-ui-menu-item"
                            :aria-selected="isActive(row.item) ? 'true' : 'false'"
                            :aria-disabled="row.item.disabled === true ? 'true' : undefined"
                            :data-highlighted="isActive(row.item) ? '' : undefined"
                            :data-disabled="row.item.disabled === true ? '' : undefined"
                            @pointermove="onPointermove(row.item)"
                            @click="onClick(row.item)"
                        >
                            <span v-if="row.item.iconClass" :class="row.item.iconClass" class="nb-ui-menu-item__icon text-[var(--text-secondary)]" aria-hidden="true"></span>
                            <span class="nb-ui-menu-item__label">{{ row.item.label }}</span>
                            <span v-if="row.item.hint" class="nb-ui-menu-item__hint">{{ row.item.hint }}</span>
                        </div>
                    </div>
                    <div v-if="empty" class="px-[10px] py-[6px] text-[12px] leading-4 text-[var(--text-muted)]" data-suggestion-menu-empty>{{ props.emptyText }}</div>
                </div>
                <div
                    v-if="props.loading"
                    class="flex shrink-0 items-center gap-2 px-[10px] py-[6px] text-[12px] leading-4 text-[var(--text-muted)]"
                    role="status"
                    data-suggestion-menu-loading
                    @mousedown.prevent
                >
                    <Spinner size="sm" />
                    <span>{{ props.loadingText }}</span>
                </div>
                <PopupScrollbar :scroll="scroll" />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
