import {nextTick, shallowRef, watch} from "vue";
import {focusPopupItem, measureCascadePanel} from "../utils/popup-geometry";

export const MENU_SUBMENU_HOVER_DELAY_MS = 300;

/** 第一次悬停等待；点击、键盘和已展开后的同级切换不等待。 */
export function createSubmenuScheduler(): {
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

/** 三个菜单入口共用的持久子面板状态：同级替换、更深层级截断、关闭清空。 */
export function useMenuCascade<T>(): {
    levels: {value: MenuCascadeLevel<T>[]};
    panels: {value: Array<HTMLElement | null>};
    setPanel(depth: number, element: unknown): void;
    schedule(value: T | null, trigger: HTMLElement, depth: number, immediate: boolean, hasChildren: boolean): void;
    /** 只留前 `depth` 级（`depth` 为 0 时全部收起），等待中的展开一并取消。 */
    truncate(depth: number): void;
    reset(): void;
    /** 键盘在一级菜单的父项上展开了子菜单（右方向键、Enter、空格）：它出现后焦点进它的第一项。 */
    expectKeyboardOpen(): void;
    /**
     * 第 `depth` 级面板里的键盘：上下、Home、End 在本级可用项之间移动；右方向键、Enter、空格在父项上展开下一级；
     * 左方向键收起本级、焦点回到展开它的那一项。焦点停在面板本身（指针离开项后）时，上下键从首末项开始。
     * `firstLevel` 是一级菜单的条目容器（reka 的菜单内容或它的视口），第 0 级的子菜单收起时在它里面找展开它的那一项。
     */
    levelKeydown(depth: number, event: KeyboardEvent, firstLevel: Element | null | undefined): void;
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

    /** 键盘展开了子菜单：它出现后把焦点放到它的第一项。 */
    let focusNewLevel = false;
    watch(() => levels.value.length, async (length, previous) => {
        if (!focusNewLevel || length <= previous) return;
        focusNewLevel = false;
        await nextTick();
        focusPopupItem(levelItems(length - 1)[0]);
    });

    /** 第 `depth` 级里可用的项，按显示顺序。 */
    function levelItems(depth: number): HTMLElement[] {
        const container = panels.value[depth]?.querySelector(".nb-menu-level-content");
        return container === null || container === undefined ? [] : [...container.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([disabled])")];
    }

    function levelKeydown(depth: number, event: KeyboardEvent, firstLevel: Element | null | undefined): void {
        const target = event.target as HTMLElement;
        const items = levelItems(depth);
        const onPanel = target === panels.value[depth];
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
            case "Enter":
            case " ":
                if (target.getAttribute("aria-haspopup") === "menu") focusNewLevel = true;
                return;
            case "ArrowLeft": {
                const parentLevel = depth === 0 ? firstLevel : panels.value[depth - 1]?.querySelector(".nb-menu-level-content");
                const trigger = parentLevel?.querySelector<HTMLElement>("[aria-expanded='true']") ?? null;
                event.preventDefault();
                if (trigger !== null) schedule(null, trigger, depth, true, false);
                focusPopupItem(trigger);
                return;
            }
        }
    }

    return {
        levels,
        panels,
        setPanel(depth, element) {
            const node = element && typeof element === "object" && "$el" in element ? element.$el : element;
            const panel = node && typeof node === "object" && "getBoundingClientRect" in node ? node as HTMLElement : null;
            panels.value[depth] = panel;
            openedPanels[depth] = panel;
        },
        schedule,
        truncate(depth) {
            scheduler.cancel();
            if (levels.value.length <= depth) return;
            levels.value = levels.value.slice(0, depth);
            openedPanels.length = depth;
        },
        reset() {
            scheduler.cancel();
            levels.value = [];
        },
        expectKeyboardOpen() {
            focusNewLevel = true;
        },
        levelKeydown,
    };
}
