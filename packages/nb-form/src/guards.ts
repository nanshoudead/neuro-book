/** 描述是外部输入（可能来自模型）：包内共用的几个形状判断。 */

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 字面量选项能取的值：字符串、有限数、布尔。 */
export function isChoiceValue(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
