/**
 * 弹出层锚点的换算（内部工具）。DropdownMenu 与 SuggestionMenu 的浮层传送到 `body`，锚点在别处：锚点自己带着
 * `transform: scale()`（按钮按下时的缩放）时，`getBoundingClientRect` 量到的是缩放后的盒子，浮层按它对齐会偏、
 * 宽度也会跟着缩。这里按锚点自己的缩放倒推回未缩放的盒子，中心不变。
 *
 * Lab 画布用的是 CSS `zoom`，不经这里：`getBoundingClientRect` 已经是窗口坐标，传送到 `body` 的浮层直接按它对齐。
 */

/** floating-ui 认的虚拟锚点：每次定位都重新读一次矩形；`contextElement` 让它知道该跟着哪些祖先的滚动。 */
export type PopoverReference = {
    getBoundingClientRect: () => DOMRect;
    contextElement?: Element;
};

export function unscaledRect(element: Element): DOMRect {
    const rect = element.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(element).transform).a || 1;
    if (scale === 1) return rect;
    const width = rect.width / scale;
    const height = rect.height / scale;
    return new DOMRect(rect.left - (width - rect.width) / 2, rect.top - (height - rect.height) / 2, width, height);
}

/** 元素锚点换成按未缩放盒子定位的虚拟锚点；宿主给的虚拟锚点（例如光标）原样使用。 */
export function toPopoverReference(anchor: Element | PopoverReference | null | undefined): PopoverReference | undefined {
    if (anchor === null || anchor === undefined) return undefined;
    if (anchor instanceof Element) return {getBoundingClientRect: () => unscaledRect(anchor), contextElement: anchor};
    return anchor;
}
