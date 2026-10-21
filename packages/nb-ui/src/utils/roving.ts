/**
 * 方向键漫游（纯函数）：按键对应哪种移动，以及在可用项之间移到哪一项。Tabs、SegmentedControl、QuickPick、SearchSelect 与
 * 级联菜单共用。各组件认哪些键、有什么门槛（修饰键、只有一项时）留在组件里，这里只管“移到哪”。
 */
export type RovingMove = "next" | "prev" | "first" | "last";

/** horizontal 认左右键，vertical 认上下键，both 都认；Home、End 都认。 */
export type RovingOrientation = "horizontal" | "vertical" | "both";

/** 按键对应的移动；不是漫游键时为 null。 */
export function rovingMove(key: string, orientation: RovingOrientation): RovingMove | null {
    const horizontal = orientation !== "vertical";
    const vertical = orientation !== "horizontal";
    switch (key) {
        case "ArrowRight":
            return horizontal ? "next" : null;
        case "ArrowLeft":
            return horizontal ? "prev" : null;
        case "ArrowDown":
            return vertical ? "next" : null;
        case "ArrowUp":
            return vertical ? "prev" : null;
        case "Home":
            return "first";
        case "End":
            return "last";
        default:
            return null;
    }
}

/**
 * 在可用项之间移动，next、prev 循环回绕；`current` 不在可用项里（-1、禁用项）时 next 从第一项、prev 从最后一项开始。
 * 返回目标下标；没有可用项时返回 -1。
 */
export function moveRoving<T>(items: readonly T[], current: number, move: RovingMove, isDisabled: (item: T) => boolean = () => false): number {
    const enabled = items.flatMap((item, index) => (isDisabled(item) ? [] : [index]));
    if (enabled.length === 0) return -1;
    if (move === "first") return enabled[0]!;
    if (move === "last") return enabled[enabled.length - 1]!;
    const position = enabled.indexOf(current);
    if (position === -1) return move === "next" ? enabled[0]! : enabled[enabled.length - 1]!;
    const delta = move === "next" ? 1 : -1;
    return enabled[(position + delta + enabled.length) % enabled.length]!;
}
