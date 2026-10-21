/**
 * 模板 ref 拿到的元素：ref 挂在组件上时拿到的是组件实例，取它的根元素 `$el`；不是元素（还没挂载、文本根）时为 null。
 */
export function elementOf(target: unknown): HTMLElement | null {
    const node = target !== null && typeof target === "object" && "$el" in target ? (target as {$el: unknown}).$el : target;
    return node instanceof HTMLElement ? node : null;
}
