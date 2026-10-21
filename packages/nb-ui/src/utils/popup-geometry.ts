/**
 * 弹出列表的几何（不依赖 Vue）：列表项的截断高度、滚进可见区，以及多级菜单的定位。
 * `usePopupScroll`、`useMenuCascade` 与右键菜单共用；依赖方向是 components → composables → utils，这里不导入那两层。
 */

/** 算作“列表项”的元素：分组标题、分隔线不算，禁用项算。 */
export const POPUP_ITEM_SELECTOR = "[role^='menuitem'], [role='option']";

/** 最多完整显示的项数；第 9 项截在中间。 */
export const POPUP_VISIBLE_ITEMS = 8;

/** 可滚动时视口右侧让出的宽度（CSS 像素）：滑块 4px，离外框 3px。 */
export const POPUP_SCROLLBAR_GUTTER = 6;

/** 元素的 CSS 像素与 `getBoundingClientRect` 像素之比：Lab 画布的 CSS `zoom` 与浮层入场的 `scale` 都会让两者不等。 */
export function rectScale(element: HTMLElement): number {
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

/*
 * 多级菜单的共享几何：面板一旦打开，每一级都按同一套规则对齐、留出间隙和翻边。
 */

export const MENU_VIEWPORT_PADDING = 8;
export const MENU_CASCADE_GAP = 6;

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
 * 量出子面板相对父项的位置和含内边距、边框的尺寸（面板所在坐标系的 CSS 像素）。三个菜单入口共用。
 *
 * 高度与主菜单同一条规则：项超过 8 个时截在第 9 项中间（量这一级的滚动视口），再夹进窗口；截断了就在右侧给滑块让出位置。
 * 父项取它此刻的真实盒子：父级滚动过，量到的就是滚动后的位置（父级一滚动宿主就收起子菜单，不会拿到过期的位置）。
 *
 * `getBoundingClientRect` 量到的是窗口像素，写回面板的 `top`、`left`、`width`、`height` 是 CSS 像素；页面或祖先有 CSS
 * `zoom` 时两者不等，所以矩形与窗口尺寸都按面板自己的比例（`rectScale`）换回 CSS 像素。面板没有入场缩放，这个比例只来自 zoom。
 */
export function measureCascadePanel(trigger: HTMLElement, panel: HTMLElement): {x: number; y: number; width: number; height: number} | null {
    const parentRect = trigger.closest("[role='menu']")?.getBoundingClientRect();
    const content = panel.querySelector<HTMLElement>(".nb-menu-level-content");
    const viewport = panel.querySelector<HTMLElement>(".nb-menu-level-viewport");
    const contentRect = content?.getBoundingClientRect() ?? panel.getBoundingClientRect();
    if (!parentRect) return null;
    const scale = rectScale(panel);
    const css = (value: number): number => value / scale;
    const anchor = trigger.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const edgeX = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
    const edgeY = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const;
    const padX = edgeX.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
    const padY = edgeY.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
    const anchorHeight = css(anchor.height);
    const firstHeight = css(panel.querySelector("[role^='menuitem']")?.getBoundingClientRect().height ?? anchor.height);
    const truncated = viewport ? measurePopupTruncation(viewport) : null;
    const contentHeight = truncated === null ? css(contentRect.height) : Math.min(css(contentRect.height), truncated);
    const view = {width: css(window.innerWidth), height: css(window.innerHeight)};
    const maxHeight = view.height - MENU_VIEWPORT_PADDING * 2;
    // 截断了，或者项不多但窗口太矮被夹住：两种情况视口都会滚动、右侧都要给滑块让位，宽度先算进去，否则内容被裁掉一截。
    const scrolls = truncated !== null || contentHeight + padY > maxHeight;
    const size = {
        width: css(contentRect.width) + padX + (scrolls ? POPUP_SCROLLBAR_GUTTER : 0),
        height: Math.min(contentHeight + padY, maxHeight),
    };
    const position = computeCascadePosition(
        {
            top: css(anchor.top) - (Number.parseFloat(style.paddingTop) || 0) - (firstHeight - anchorHeight) / 2,
            left: css(anchor.left),
            right: css(anchor.right),
            bottom: css(anchor.bottom),
            panelLeft: css(parentRect.left),
            panelRight: css(parentRect.right),
        },
        size,
        view,
    );
    return {x: position.x, y: position.y, width: Math.ceil(size.width), height: Math.ceil(size.height)};
}
