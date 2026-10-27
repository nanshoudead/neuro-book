/**
 * 界面文字的值与纯数据层（docs/specs/ui/i18n.md）：类型、判别、`LocaleMap` 的解析与参数整理。
 *
 * 这里不引 Vue、不引 i18next：服务端加载的共享模块（例如命令的 `when` 求值）也会用到它，服务端只解析字符串与
 * `LocaleMap`，`TextRef` 只在浏览器经翻译端口翻译。
 */

/** 要显示给用户的一段文字：字面文字、目录里的键，或按语言给出的几份。 */
export type Text = string | TextRef | LocaleMap;

export type TextParams = Readonly<Record<string, string | number>>;

/** 目录里的一个键。`kind` 不是合法的语言标签，所以不会被判成 `LocaleMap`（输出 1）。 */
export interface TextRef {
    readonly kind: "text";
    /** 命名空间（插件 id 或包名）；声明里不写，由宿主在登记时补上。 */
    readonly ns?: string;
    /** 用 `.` 分层，不含 `:`。 */
    readonly key: string;
    readonly params?: TextParams;
}

/** 语言标签到文字；现有的 `{zh-CN, en-US}` 是它的特例。 */
export type LocaleMap = Readonly<Record<string, string>>;

/** 整理参数、找不到键时交给提供方的问题；同一类问题对同一键只报一次由提供方负责。 */
export interface TextProblem {
    readonly kind: "missing-key" | "missing-param" | "param-dropped" | "param-truncated";
    readonly ns: string | undefined;
    readonly key: string;
    readonly param?: string;
}

export type ReportTextProblem = (problem: TextProblem) => void;

export function textRef(key: string, params?: TextParams, ns?: string): TextRef {
    return {kind: "text", key, ...(ns === undefined ? {} : {ns}), ...(params === undefined ? {} : {params})};
}

export function isTextRef(value: unknown): value is TextRef {
    return typeof value === "object" && value !== null && (value as {kind?: unknown}).kind === "text" && typeof (value as {key?: unknown}).key === "string";
}

export function isLocaleTag(tag: string): boolean {
    try {
        return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
        // getCanonicalLocales 对不合法的标签抛 RangeError：这正是“不是语言标签”的答案，不是要上报的错误。
        return false;
    }
}

export function isLocaleMap(value: unknown): value is LocaleMap {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.entries(value).every(([tag, text]) => isLocaleTag(tag) && typeof text === "string");
}

export function isText(value: unknown): value is Text {
    return typeof value === "string" || isTextRef(value) || isLocaleMap(value);
}

/** 输出 2：取当前语言，取不到取 `en-US`，再取第一项；空对象得空字符串。 */
export function resolveLocaleMap(map: LocaleMap, locale: string): string {
    return map[locale] ?? map["en-US"] ?? Object.values(map)[0] ?? "";
}

export const MAX_PARAM_LENGTH = 500;

/**
 * 输出 3：参数只能是字符串或有限数字；过长的字符串截断，其它值不传。每种整理都上报，不静默丢弃。
 * 入参按 `unknown` 收：调用方可能来自 JS、清单 JSON 或远程结果，类型声明管不到运行期的值。
 */
export function sanitizeParams(params: Readonly<Record<string, unknown>> | undefined, report: (param: string, kind: "param-dropped" | "param-truncated") => void): TextParams {
    const result: Record<string, string | number> = {};
    if (params === undefined) return result;
    for (const [name, value] of Object.entries(params)) {
        if (typeof value === "number" && Number.isFinite(value)) {
            result[name] = value;
        } else if (typeof value === "string") {
            if (value.length > MAX_PARAM_LENGTH) {
                result[name] = `${value.slice(0, MAX_PARAM_LENGTH)}…`;
                report(name, "param-truncated");
            } else {
                result[name] = value;
            }
        } else {
            report(name, "param-dropped");
        }
    }
    return result;
}

/** 一个命名空间在一种语言下的目录：键到文字，值也可以是嵌套对象（键用 `.` 连起来）。 */
export interface Catalog {
    readonly [key: string]: string | Catalog;
}

/** 把嵌套目录展开成点号路径的扁平表。 */
export function flattenCatalog(catalog: Catalog, prefix = ""): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(catalog)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        if (typeof value === "string") result[path] = value;
        else Object.assign(result, flattenCatalog(value, path));
    }
    return result;
}
