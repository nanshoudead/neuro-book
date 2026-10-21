import {computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, type ComputedRef, type Ref} from "vue";

import {dragScrollTop, thumbGeometry, trackLength} from "../utils/scrollbar-geometry";

/**
 * 弹出列表（菜单、下拉、选择器、候选）的滚动：截断高度、悬浮滑块、顶底渐隐与键盘跟随。六个列表与级联菜单的每一级各用一份。
 *
 * 高度分两层，都不在这里夹到窗口：
 * - 外框由宿主按可用空间夹紧（reka 浮层的 `--reka-popper-available-height`，或右键菜单的窗口高度），外框是纵向 flex，
 *   标题、加载这些固定部分不收缩，唯一的滚动视口 `min-height: 0` 可以收缩；
 * - 视口自己的 `max-height` 由这里给：列表项超过 8 个时截在第 9 项的中点，露出半项提示还能往下滚（w00029 t04 决定 5）。
 * 可用空间比截断高度还小时，外框的夹紧先起作用，视口照可用空间收矮，不再保证截在半项。
 *
 * 只操作宿主给的那一个视口，不另包滚动层：Select 的视口是 reka 的 `SelectViewport`，打开时由 reka 滚到选中项，
 * 这里不重置 `scrollTop`。
 */

/** 算作“列表项”的元素：分组标题、分隔线不算，禁用项算。 */
export const POPUP_ITEM_SELECTOR = "[role^='menuitem'], [role='option']";

/** 最多完整显示的项数；第 9 项截在中间。 */
export const POPUP_VISIBLE_ITEMS = 8;

/** 可滚动时视口右侧让出的宽度（CSS 像素）：滑块 4px，离外框 3px。 */
export const POPUP_SCROLLBAR_GUTTER = 6;

/** 滑块轨道上下各让出的距离（CSS 像素）：滑块不贴着外框的圆角。滑块几何与 `OverlayScrollbar` 共用 `scrollbar-geometry`。 */
const TRACK_INSET = 6;

/** 元素的 CSS 像素与 `getBoundingClientRect` 像素之比：Lab 画布的 CSS `zoom` 与浮层入场的 `scale` 都会让两者不等。 */
function rectScale(element: HTMLElement): number {
    const height = element.offsetHeight;
    if (height === 0) return 1;
    const scale = element.getBoundingClientRect().height / height;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 视口截在第 9 项中点时的高度（CSS 像素，含视口自己的内边距）；项不超过 8 个时返回 null，视口取自然高度。
 * 按真实盒子量，分组标题、分隔线、两行项与换行项照实计入，不按固定行高乘。
 */
export function measurePopupTruncation(viewport: HTMLElement): number | null {
    const items = viewport.querySelectorAll<HTMLElement>(POPUP_ITEM_SELECTOR);
    const ninth = items[POPUP_VISIBLE_ITEMS];
    if (ninth === undefined) return null;
    const rect = ninth.getBoundingClientRect();
    // 还没有布局（隐藏、未插入文档）时量到的全是 0，返回的高度会是 0；等观察器在有布局后再量。
    if (rect.height === 0) return null;
    const scale = rectScale(viewport);
    const top = viewport.getBoundingClientRect().top;
    return (rect.top - top) / scale + viewport.scrollTop + rect.height / scale / 2;
}

/**
 * 顶底渐隐的高度（CSS 像素，与 `styles.css` 的 `--nb-popover-scroll-fade` 缺省值相同）：滚进可见区的项要让到它外面，
 * 否则正好落在半透明的渐隐里。滚到列表两端时那一侧没有渐隐，浏览器把滚动位置夹在端点，项照样贴边。
 */
const FADE_MARGIN = 22;

/** 把视口里的一项滚进可见区，只滚这个视口、只滚最少的距离（让开渐隐）；键盘移到看不见的项时由列表调用。 */
export function revealPopupItem(viewport: HTMLElement | null, item: Element | null): void {
    if (viewport === null || item === null) return;
    const scale = rectScale(viewport);
    const view = viewport.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    const margin = Math.min(FADE_MARGIN * scale, Math.max(0, (view.height - rect.height) / 2));
    if (rect.top < view.top + margin) viewport.scrollTop -= (view.top + margin - rect.top) / scale;
    else if (rect.bottom > view.bottom - margin) viewport.scrollTop += (rect.bottom - (view.bottom - margin)) / scale;
}

/** 键盘把焦点移到一项：不让浏览器按聚焦的规则居中滚动，只把它滚进它所在的列表视口。 */
export function focusPopupItem(item: HTMLElement | null | undefined): void {
    if (item === null || item === undefined) return;
    item.focus({preventScroll: true});
    revealPopupItem(item.closest<HTMLElement>(".nb-ui-popover-scroll"), item);
}

export interface PopupScroll {
    /** 视口的模板 ref 回调；视口换实例时重新观察。 */
    setViewport: (element: unknown) => void;
    viewport: Ref<HTMLElement | null>;
    /** 绑到视口上：截断高度；可滚动时右侧让出滑块的位置，滑块不压在项的高亮与快捷键上。 */
    viewportStyle: ComputedRef<Record<string, string>>;
    /** 绑到视口上：顶底渐隐的类名。 */
    fadeClass: ComputedRef<string>;
    /** 绑到视口的 `scroll` 事件。 */
    onScroll: () => void;
    /** 滑块：是否显示、轨道在外框里的位置与长度、滑块位置与长度（CSS 像素）。 */
    scrollable: Ref<boolean>;
    trackTop: Ref<number>;
    trackHeight: Ref<number>;
    thumbTop: Ref<number>;
    thumbHeight: Ref<number>;
    dragging: Ref<boolean>;
    /** 绑到滑块的 `pointerdown`。 */
    startDrag: (event: PointerEvent) => void;
    /** 键盘移到看不见的项时滚过去。 */
    reveal: (item: Element | null) => void;
    /** 内容变了但视口尺寸没变时（例如同级子菜单换了内容）由宿主补一次重新测量。 */
    remeasure: () => void;
}

export function usePopupScroll(): PopupScroll {
    const viewport = ref<HTMLElement | null>(null);
    const maxHeight = ref<number | null>(null);
    const scrollable = ref(false);
    const atTop = ref(true);
    const atBottom = ref(true);
    const trackTop = ref(0);
    const trackHeight = ref(0);
    const thumbTop = ref(0);
    const thumbHeight = ref(0);
    const dragging = ref(false);

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let frame: number | null = null;
    let drag: {pointerId: number; target: HTMLElement; startY: number; startScroll: number} | null = null;

    /** 滑块几何只依赖滚动位置与视口尺寸；滚动时只跑这一段。 */
    function syncThumb(element: HTMLElement): void {
        const {scrollTop, scrollHeight, clientHeight} = element;
        const thumb = thumbGeometry({scrollTop, scrollHeight, clientHeight}, {inset: TRACK_INSET});
        scrollable.value = thumb !== null;
        atTop.value = scrollTop <= 1;
        atBottom.value = scrollTop + clientHeight >= scrollHeight - 1;
        trackTop.value = element.offsetTop + TRACK_INSET;
        trackHeight.value = trackLength(clientHeight, TRACK_INSET);
        if (thumb === null) return;
        thumbHeight.value = thumb.size;
        thumbTop.value = thumb.offset;
    }

    /**
     * 截断高度变了：等新高度生效后把聚焦的那一项滚回可见区。列表打开时原语先聚焦并滚到当前项（Select 滚到选中项），
     * 那时视口还是自然高度；截断随后才生效，不补这一下，当前项会正好落在被截的那半行上。
     */
    function measure(): void {
        frame = null;
        const element = viewport.value;
        if (element === null) return;
        const next = measurePopupTruncation(element);
        const changed = next !== maxHeight.value;
        maxHeight.value = next;
        syncThumb(element);
        if (!changed) return;
        void nextTick(() => {
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && element.contains(focused)) revealPopupItem(element, focused.closest(POPUP_ITEM_SELECTOR) ?? focused);
            syncThumb(element);
        });
    }

    /** 观察器的回调可能一帧来好几次（视口与内容各一次），合到下一帧量一次。 */
    function schedule(): void {
        if (frame !== null) return;
        frame = requestAnimationFrame(measure);
    }

    function disconnect(): void {
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        resizeObserver = null;
        mutationObserver = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
    }

    function setViewport(element: unknown): void {
        const node = element !== null && typeof element === "object" && "$el" in element ? (element as {$el: unknown}).$el : element;
        const next = node instanceof HTMLElement ? node : null;
        if (next === viewport.value) return;
        // 视口卸载时滑块也跟着离开文档，拖动的 pointerup 再也到不了它：在这里收口，否则下次打开滑块仍是“拖动中”。
        endDrag();
        disconnect();
        viewport.value = next;
        if (next === null) return;
        measure();
        // 过滤、追加候选会改内容高度而视口尺寸不变（已经截断时），所以内容也要看：
        // 视口与它的直接子元素看尺寸，子树看增删。
        if (typeof ResizeObserver === "undefined") return;
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(next);
        for (const child of Array.from(next.children)) resizeObserver.observe(child);
        let observed = new Set(next.children);
        mutationObserver = new MutationObserver(() => {
            const current = new Set(next.children);
            for (const child of observed) if (!current.has(child)) resizeObserver?.unobserve(child);
            for (const child of current) if (!observed.has(child)) resizeObserver?.observe(child);
            observed = current;
            schedule();
        });
        mutationObserver.observe(next, {childList: true, subtree: true});
    }

    function onScroll(): void {
        if (viewport.value !== null) syncThumb(viewport.value);
    }

    /**
     * 拖动滑块：指针捕获在滑块上，移动与松开都由它收，不挂窗口监听。指针位移是 `getBoundingClientRect` 的像素，
     * 换成视口的 CSS 像素再折算成滚动距离，Lab 画布缩放下滑块也跟手。
     */
    function startDrag(event: PointerEvent): void {
        const element = viewport.value;
        const target = event.currentTarget;
        if (element === null || !(target instanceof HTMLElement) || event.button !== 0) return;
        // 不让按下滑块夺走列表里的焦点，也不让菜单把它当成选中某一项。
        event.preventDefault();
        event.stopPropagation();
        drag = {pointerId: event.pointerId, target, startY: event.clientY, startScroll: element.scrollTop};
        dragging.value = true;
        target.setPointerCapture(event.pointerId);
        target.addEventListener("pointermove", onDragMove);
        target.addEventListener("pointerup", endDrag);
        target.addEventListener("pointercancel", endDrag);
    }

    function onDragMove(event: PointerEvent): void {
        const element = viewport.value;
        if (drag === null || element === null || event.pointerId !== drag.pointerId) return;
        const delta = (event.clientY - drag.startY) / rectScale(element);
        const start = {scrollTop: drag.startScroll, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight};
        element.scrollTop = dragScrollTop(start, delta, {inset: TRACK_INSET});
    }

    function endDrag(): void {
        if (drag === null) return;
        const {target, pointerId} = drag;
        target.removeEventListener("pointermove", onDragMove);
        target.removeEventListener("pointerup", endDrag);
        target.removeEventListener("pointercancel", endDrag);
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        drag = null;
        dragging.value = false;
    }

    if (getCurrentInstance() !== null) {
        onBeforeUnmount(() => {
            endDrag();
            disconnect();
        });
    }

    return {
        setViewport,
        viewport,
        viewportStyle: computed(() => ({
            ...(maxHeight.value === null ? {} : {maxHeight: `${String(Math.round(maxHeight.value))}px`}),
            ...(scrollable.value ? {paddingRight: `${String(POPUP_SCROLLBAR_GUTTER)}px`} : {}),
        })),
        fadeClass: computed(() => {
            if (!scrollable.value) return "";
            if (!atTop.value && !atBottom.value) return "nb-ui-popover-scroll-fade-both";
            if (!atTop.value) return "nb-ui-popover-scroll-fade-top";
            return atBottom.value ? "" : "nb-ui-popover-scroll-fade-bottom";
        }),
        onScroll,
        scrollable,
        trackTop,
        trackHeight,
        thumbTop,
        thumbHeight,
        dragging,
        startDrag,
        reveal: (item) => revealPopupItem(viewport.value, item),
        remeasure: schedule,
    };
}
