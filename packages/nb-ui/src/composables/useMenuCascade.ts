import {nextTick, onBeforeUnmount, shallowRef, watch} from "vue";
import {elementOf} from "../utils/element-of";
import {focusPopupItem, measureCascadePanel} from "../utils/popup-geometry";
import {moveRoving, rovingMove} from "../utils/roving";

const MENU_SUBMENU_HOVER_DELAY_MS = 300;

/** 第一次悬停等待；点击、键盘和已展开后的同级切换不等待。 */
function createSubmenuScheduler(): {
    schedule(open: () => void, options: {immediate: boolean; hasOpenSibling: boolean}): void;
    cancel(): void;
} {
    let timer: number | null = null;
    return {
        schedule(open, options) {
            this.cancel();
            if (options.immediate || options.hasOpenSibling) {
                open();
                return;
            }
            timer = window.setTimeout(open, MENU_SUBMENU_HOVER_DELAY_MS);
        },
        cancel() {
            if (timer === null) return;
            window.clearTimeout(timer);
            timer = null;
        },
    };
}

export interface MenuCascadeLevel<T> {
    value: T;
    style: Record<string, string>;
    switching: boolean;
}

export interface MenuCascadeOptions {
    /**
     * 第一级菜单的条目容器，条目是它的直接子元素：DropdownMenu 的一级滚动视口、Menubar 打开着的那组的视口、右键菜单根里的
     * `.nb-menu-level-content`。第 0 级子菜单收起（左方向键、第一级滚动）时在这里找展开它的那一项；它所在的
     * `[role=menu]` 就是第一级面板（焦点停在面板本身时按这个认）。
     */
    rootLevel: () => Element | null;
    /** 第一级的上下键、Home、End 由这里处理：右键菜单的第一级是普通按钮，要；reka 的第一级由 reka 处理，不要。 */
    rootRoving: boolean;
}

/**
 * 三个菜单入口（DropdownMenu、Menubar、右键菜单）共用的手工级联：持久子面板的状态（同级替换、更深层级截断、关闭清空），
 * 键盘（第一级与各级面板），父级滚动时收起，以及“级联面板不算菜单外部”的判定。
 *
 * 挂法：`rootKeydown` 挂在第一级面板上（reka 的菜单内容要用 `@keydown.capture`，赶在 reka 自己的处理之前），`levelKeydown`
 * 挂在每一级 `MenuLevelPanel` 的根上。两者都不碰 Tab、Escape，也不阻止冒泡：右键菜单的 Tab、Escape 由它在 document 上的
 * 监听处理，reka 菜单的由 reka 处理。
 */
export function useMenuCascade<T>(options: MenuCascadeOptions): {
    levels: {value: MenuCascadeLevel<T>[]};
    panels: {value: Array<HTMLElement | null>};
    setPanel(depth: number, element: unknown): void;
    schedule(value: T | null, trigger: HTMLElement, depth: number, immediate: boolean, hasChildren: boolean): void;
    /** 只留前 `depth` 级（`depth` 为 0 时全部收起），等待中的展开一并取消。 */
    truncate(depth: number): void;
    reset(): void;
    /** 第一级面板的键盘：父项上的右方向键、Enter、空格展开后焦点跟进新的一级；`rootRoving` 时另管上下、Home、End。 */
    rootKeydown(event: KeyboardEvent): void;
    /**
     * 第 `depth` 级面板里的键盘：上下、Home、End 在本级可用项之间移动；右方向键、Enter、空格在父项上展开后焦点跟进；
     * 左方向键收起本级、焦点回到展开它的那一项。
     */
    levelKeydown(depth: number, event: KeyboardEvent): void;
    /** 第 `depth` 级（0 为第一级）滚动了：收起它展开的更深层级，焦点在被收起的层级里时回到展开它的那一项。 */
    collapseBelow(depth: number): void;
    /** 目标在某一级级联面板里：面板在 reka 的菜单内容之外，但属于这个菜单。 */
    contains(target: EventTarget | null): boolean;
} {
    const levels = shallowRef<MenuCascadeLevel<T>[]>([]);
    const panels = shallowRef<Array<HTMLElement | null>>([]);
    const openedPanels: Array<HTMLElement | null> = [];
    const scheduler = createSubmenuScheduler();
    async function open(value: T | null, trigger: HTMLElement, depth: number, hasChildren: boolean): Promise<void> {
        if (!hasChildren || value === null) {
            levels.value = levels.value.slice(0, depth);
            openedPanels.length = depth;
            return;
        }
        const switching = Boolean(levels.value[depth]);
        const previous = levels.value[depth]?.style ?? {};
        levels.value = [...levels.value.slice(0, depth), {value, style: previous, switching}];
        openedPanels.length = depth;
        await nextTick();
        const panel = openedPanels[depth];
        const measured = panel ? measureCascadePanel(trigger, panel) : null;

        if (!measured) {
            levels.value = levels.value.slice(0, depth);
            openedPanels.length = depth;
            return;
        }
        const nextLevels = [...levels.value];
        nextLevels[depth] = {value, switching, style: {top: `${measured.y}px`, left: `${measured.x}px`, width: `${measured.width}px`, height: `${measured.height}px`}};
        levels.value = nextLevels;
    }
    function schedule(value: T | null, trigger: HTMLElement, depth: number, immediate: boolean, hasChildren: boolean): void {
        scheduler.schedule(() => void open(value, trigger, depth, hasChildren), {immediate, hasOpenSibling: Boolean(levels.value[depth])});
    }

    function truncate(depth: number): void {
        scheduler.cancel();
        pendingFocus = null;
        if (levels.value.length <= depth) return;
        levels.value = levels.value.slice(0, depth);
        openedPanels.length = depth;
    }

    /**
     * 键盘在父项上展开了第 `pendingFocus` 级：这一级下一次写入后把焦点放到它的第一项，用掉就清。看每次写入而不只看层数：
     * 这一级已经开着（指针先展开了它）时再按右方向键，层数不变，焦点也要进去。下一次写入后这一级不在（量不到、被收起）时
     * 预约作废，不留到之后指针打开的别的子菜单上。
     *
     * 先后：DropdownMenu、Menubar 的 `rootKeydown` 在 capture 上，先预约、后展开；右键菜单的按钮项先在自己的 keydown 里
     * 展开（同步写入 `levels`），再冒泡到这里预约。watch 的回调排在这一轮事件之后执行，两种先后都能看到预约。
     */
    let pendingFocus: number | null = null;
    watch(levels, async (next) => {
        const depth = pendingFocus;
        if (depth === null) return;
        pendingFocus = null;
        if (next.length <= depth) return;
        await nextTick();
        focusPopupItem(itemsIn(levelContent(depth))[0]);
    });
    // 首次悬停的展开要等 300ms：宿主在这之前整个卸载时，回调不该再去量已经不在的面板。
    onBeforeUnmount(() => {
        scheduler.cancel();
        pendingFocus = null;
    });

    /** 第 `depth` 级级联面板的条目容器。 */
    function levelContent(depth: number): Element | null {
        return panels.value[depth]?.querySelector(".nb-menu-level-content") ?? null;
    }

    /** 第 `depth` 级子菜单的父级条目容器：第 0 级的父级是第一级菜单。 */
    function parentLevel(depth: number): Element | null {
        return depth === 0 ? options.rootLevel() : levelContent(depth - 1);
    }

    /** 容器里可用的项，按显示顺序。 */
    function itemsIn(container: Element | null): HTMLElement[] {
        return container === null ? [] : [...container.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([disabled])")];
    }

    /** 父项上的右方向键、Enter、空格：展开由 MenuNodes 或 reka 做，这里只预约焦点进它展开的第 `childDepth` 级。 */
    function expectOpen(event: KeyboardEvent, childDepth: number): void {
        const target = event.target as HTMLElement;
        if (target.getAttribute("aria-haspopup") === "menu" && ["ArrowRight", "Enter", " "].includes(event.key)) pendingFocus = childDepth;
    }

    /**
     * 上下、Home、End 在 `items`（已是可用项）里移动；焦点停在面板本身（`onPanel`）时没有当前项，上下键从首末项开始。
     * 处理了返回 true。
     */
    function rove(event: KeyboardEvent, items: HTMLElement[], onPanel: boolean): boolean {
        const index = items.indexOf(event.target as HTMLElement);
        if (index < 0 && !onPanel) return false;
        const move = rovingMove(event.key, "vertical");
        if (move === null) return false;
        event.preventDefault();
        focusPopupItem(items[moveRoving(items, index, move)]);
        return true;
    }

    function rootKeydown(event: KeyboardEvent): void {
        const container = options.rootLevel();
        if (options.rootRoving && rove(event, itemsIn(container), event.target === container?.closest("[role='menu']"))) return;
        expectOpen(event, 0);
    }

    function levelKeydown(depth: number, event: KeyboardEvent): void {
        if (rove(event, itemsIn(levelContent(depth)), event.target === panels.value[depth])) return;
        if (event.key !== "ArrowLeft") {
            expectOpen(event, depth + 1);
            return;
        }
        const trigger = parentLevel(depth)?.querySelector<HTMLElement>(":scope > [aria-expanded='true']") ?? null;
        event.preventDefault();
        if (trigger !== null) schedule(null, trigger, depth, true, false);
        focusPopupItem(trigger);
    }

    function collapseBelow(depth: number): void {
        if (levels.value.length <= depth) return;
        const focusInside = panels.value.slice(depth).some((panel) => panel?.contains(document.activeElement) === true);
        const trigger = parentLevel(depth)?.querySelector<HTMLElement>(":scope > [aria-expanded='true']") ?? null;
        truncate(depth);
        if (focusInside) trigger?.focus({preventScroll: true});
    }

    return {
        levels,
        panels,
        setPanel(depth, element) {
            const panel = elementOf(element);
            panels.value[depth] = panel;
            openedPanels[depth] = panel;
        },
        schedule,
        truncate,
        reset() {
            scheduler.cancel();
            pendingFocus = null;
            levels.value = [];
        },
        rootKeydown,
        levelKeydown,
        collapseBelow,
        contains(target) {
            return target instanceof Node && panels.value.some((panel) => panel?.contains(target) === true);
        },
    };
}
