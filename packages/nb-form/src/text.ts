/**
 * 表单里的文字（docs/specs/ui/forms.md“输入与前置条件”）：单语字符串，或按语言给出的文字。与应用的 `LocalizedText`
 * 结构兼容，但不依赖应用包：nbdev 面板与模型生成的描述都只给字符串。
 */

export type FormText = string | Readonly<Record<string, string>>;

/** 回退的语言：所给语言没有时取它，再没有取第一种。 */
export const FALLBACK_LOCALE = "en-US";

export function resolveText(text: FormText | undefined, locale: string): string {
    if (text === undefined) return "";
    if (typeof text === "string") return text;
    return text[locale] ?? text[FALLBACK_LOCALE] ?? Object.values(text)[0] ?? "";
}

export function isFormText(value: unknown): value is FormText {
    if (typeof value === "string") return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const entries = Object.values(value);
    return entries.length > 0 && entries.every((entry) => typeof entry === "string");
}
