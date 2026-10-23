/**
 * 答案卡片的依据一行（决定 15）放得下几个出处：其余换成一个“等 N 处”。个数只由宽度决定，不随点击变；卡片按自己量到的
 * 宽度调用（ResizeObserver），宽度变了才重算。
 */

export interface RefLineInput {
    /** 各个出处小块的宽度（含与前一个之间的间距），按顺序。 */
    readonly widths: readonly number[];
    /** 出处区可用的宽度。 */
    readonly available: number;
    /** “等 N 处”占的宽度（按位数预留的固定宽度，含间距）。 */
    readonly moreWidth: number;
}

/** 放得下几个；全都放得下时不需要“等 N 处”。至少放一个（一个都放不下时让它自己截断）。 */
export function visibleRefCount({widths, available, moreWidth}: RefLineInput): number {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total <= available) return widths.length;
    let used = 0;
    let count = 0;
    for (const width of widths) {
        if (used + width + moreWidth > available) break;
        used += width;
        count += 1;
    }
    return Math.max(1, Math.min(count, widths.length));
}
