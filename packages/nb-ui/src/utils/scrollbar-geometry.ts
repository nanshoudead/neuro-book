/**
 * 自绘滚动条的滑块几何：纯函数，输入滚动元素的三个读数，给出滑块的位置与大小，以及拖动、点轨道时的目标滚动位置。
 * `OverlayScrollbar` 与 `usePopupScroll`（弹出列表的 `PopupScrollbar`）共用这一份，所以放在 utils：composables
 * 不能反向依赖 components。
 *
 * 轨道是滚动元素可见高度去掉上下各 `inset` 之后的一段，滑块高度与可见比例相同、不小于下限。`OverlayScrollbar` 的轨道
 * 就是整个可见高度（`inset` 为 0）；弹出列表的轨道上下各让出一点，滑块不贴着外框的圆角。
 */

/** 滚动元素的三个读数（`scrollTop`、`clientHeight`、`scrollHeight`）。 */
export interface ScrollMetrics {
    readonly scrollTop: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
}

/** 滑块：`null` 表示内容不溢出、不画。`offset` 是滑块顶离轨道顶的距离，不含 `inset`。 */
export interface ThumbGeometry {
    readonly offset: number;
    readonly size: number;
}

/** 各函数共有的轨道参数，缺省时轨道就是整个可见高度、滑块最短 `MIN_THUMB_PX`。 */
export interface TrackOptions {
    /** 轨道上下各让出的距离（CSS 像素）。 */
    readonly inset?: number;
    readonly minThumb?: number;
}

/** 滑块最短 20px：内容很长时仍能抓住。 */
export const MIN_THUMB_PX = 20;

/** 内容只比可见区高出不到 1px 时按不溢出算：缩放与小数像素会让 scrollHeight 比 clientHeight 多出零点几。 */
const OVERFLOW_EPSILON = 1;

const maxScroll = (metrics: ScrollMetrics): number => Math.max(0, metrics.scrollHeight - metrics.clientHeight);

/** 轨道长度：可见高度去掉上下各 `inset`，不小于 0。 */
export function trackLength(clientHeight: number, inset = 0): number {
    return Math.max(0, clientHeight - inset * 2);
}

export function thumbGeometry(metrics: ScrollMetrics, {inset = 0, minThumb = MIN_THUMB_PX}: TrackOptions = {}): ThumbGeometry | null {
    const {clientHeight, scrollHeight} = metrics;
    if (clientHeight <= 0 || scrollHeight - clientHeight < OVERFLOW_EPSILON) return null;
    const track = trackLength(clientHeight, inset);
    const size = Math.min(track, Math.max(minThumb, (track * clientHeight) / scrollHeight));
    const travel = track - size;
    const range = maxScroll(metrics);
    const offset = range > 0 ? (Math.min(Math.max(metrics.scrollTop, 0), range) / range) * travel : 0;
    return {offset, size};
}

/** 从按下时的滚动位置起，指针纵向移动 `delta` 像素后的滚动位置：滑块走完轨道等于内容滚完。 */
export function dragScrollTop(start: ScrollMetrics, delta: number, options: TrackOptions = {}): number {
    const thumb = thumbGeometry(start, options);
    const range = maxScroll(start);
    if (thumb === null || range === 0) return start.scrollTop;
    const travel = trackLength(start.clientHeight, options.inset) - thumb.size;
    if (travel <= 0) return start.scrollTop;
    return Math.min(range, Math.max(0, start.scrollTop + (delta / travel) * range));
}

/** 点在滑块以外的轨道上：朝那一侧滚一页（可见高度），不越界。`at` 是点击处相对轨道顶的纵坐标。 */
export function pageScrollTop(metrics: ScrollMetrics, at: number, options: TrackOptions = {}): number {
    const thumb = thumbGeometry(metrics, options);
    if (thumb === null) return metrics.scrollTop;
    const range = maxScroll(metrics);
    if (at < thumb.offset) return Math.max(0, metrics.scrollTop - metrics.clientHeight);
    if (at > thumb.offset + thumb.size) return Math.min(range, metrics.scrollTop + metrics.clientHeight);
    return metrics.scrollTop;
}
