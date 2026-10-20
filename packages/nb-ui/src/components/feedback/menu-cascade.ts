import {measurePopupTruncation, POPUP_SCROLLBAR_GUTTER} from "../../composables/usePopupScroll";

/**
 * 多级菜单的共享几何。
 *
 * 面板一旦打开，每一级都按同一套规则对齐、留出间隙和翻边。
 */

export const MENU_VIEWPORT_PADDING = 8;
export const MENU_CASCADE_GAP = 6;

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
export type MenuSize = {width: number; height: number};
export type MenuViewport = {width: number; height: number};
export type MenuAnchor = {top: number; left: number; right: number; bottom: number; panelLeft?: number; panelRight?: number; panelPaddingTop?: number};

/**
 * 主菜单钳进视口：右/下溢出时向内收，最小不小于 padding。
 */
export function clampMenuPosition(
    x: number,
    y: number,
    menu: MenuSize,
    viewport: MenuViewport,
    padding = MENU_VIEWPORT_PADDING,
): {x: number; y: number} {
    let nextX = x;
    let nextY = y;
    if (x + menu.width > viewport.width - padding) {
        nextX = viewport.width - menu.width - padding;
    }
    if (y + menu.height > viewport.height - padding) {
        nextY = viewport.height - menu.height - padding;
    }
    return {x: Math.max(padding, nextX), y: Math.max(padding, nextY)};
}

/**
 * 下一级菜单相对父项的位置。
 *
 * 第一项与父项同一行，两个面板之间留 `gap` 像素。
 * 右侧放不下时翻到左侧；翻面后仍放不下时再钳进视口。
 */
export function computeCascadePosition(
    anchor: MenuAnchor,
    menu: MenuSize,
    viewport: MenuViewport,
    padding = MENU_VIEWPORT_PADDING,
    gap = MENU_CASCADE_GAP,
): {x: number; y: number} {
    const safeGap = Math.max(0, gap);
    const parentLeft = anchor.panelLeft ?? anchor.left;
    const parentRight = anchor.panelRight ?? anchor.right;
    const rightX = parentRight + safeGap;
    const leftX = parentLeft - menu.width - safeGap;
    const fitsRight = rightX + menu.width <= viewport.width - padding;
    const fitsLeft = leftX >= padding;
    let nextX = fitsRight || !fitsLeft ? rightX : leftX;
    let nextY = anchor.top - (anchor.panelPaddingTop ?? 0);

    if (nextX + menu.width > viewport.width - padding) {
        nextX = viewport.width - menu.width - padding;
    }
    if (nextY + menu.height > viewport.height - padding) {
        nextY = viewport.height - menu.height - padding;
    }
    return {x: Math.max(padding, nextX), y: Math.max(padding, nextY)};
}

/**
 * 量出子面板相对父项的位置和含内边距、边框的尺寸。三个菜单入口共用。
 *
 * 高度与主菜单同一条规则：项超过 8 个时截在第 9 项中间（量这一级的滚动视口），再夹进窗口；截断了就在右侧给滑块让出位置。
 * 父项取它此刻的真实盒子：父级滚动过，量到的就是滚动后的位置（父级一滚动宿主就收起子菜单，不会拿到过期的位置）。
 */
export function measureCascadePanel(trigger: HTMLElement, panel: HTMLElement): {x: number; y: number; width: number; height: number} | null {
    const element = panel && "querySelector" in panel ? panel : (panel as {$el?: HTMLElement} | null)?.$el ?? null;
    const parent = trigger.closest("[role='menu']")?.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const content = element?.querySelector<HTMLElement>(".nb-menu-level-content");
    const viewport = element?.querySelector<HTMLElement>(".nb-menu-level-viewport");
    const rect = content?.getBoundingClientRect() ?? element?.getBoundingClientRect();
    if (!parent || !element || !rect) return null;
    const style = getComputedStyle(element);
    const edgeX = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
    const edgeY = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const;
    const padX = edgeX.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
    const padY = edgeY.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
    const firstHeight = panel.querySelector("[role^='menuitem']")?.getBoundingClientRect().height ?? anchor.height;
    const truncated = viewport ? measurePopupTruncation(viewport) : null;
    const contentHeight = truncated === null ? rect.height : Math.min(rect.height, truncated);
    const maxHeight = window.innerHeight - MENU_VIEWPORT_PADDING * 2;
    // 截断了，或者项不多但窗口太矮被夹住：两种情况视口都会滚动、右侧都要给滑块让位，宽度先算进去，否则内容被裁掉一截。
    const scrolls = truncated !== null || contentHeight + padY > maxHeight;
    const size = {
        width: rect.width + padX + (scrolls ? POPUP_SCROLLBAR_GUTTER : 0),
        height: Math.min(contentHeight + padY, maxHeight),
    };
    const position = computeCascadePosition(
        {top: anchor.top - (Number.parseFloat(style.paddingTop) || 0) - (firstHeight - anchor.height) / 2, left: anchor.left, right: anchor.right, bottom: anchor.bottom, panelLeft: parent.left, panelRight: parent.right},
        size,
        {width: window.innerWidth, height: window.innerHeight},
    );
    return {x: position.x, y: position.y, width: Math.ceil(size.width), height: Math.ceil(size.height)};
}

