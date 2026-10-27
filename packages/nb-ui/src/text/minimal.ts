/**
 * 不依赖 i18next 的翻译（docs/specs/ui/i18n.md 输出 4 到 7、9、10）：只支持 `{{name}}` 插值与 `_one`、`_other` 这类
 * 复数后缀。nb-ui 的缺省端口与没有宿主的共享包用它；宿主的引擎对同一组目录必须给出相同的结果（输出 9）。
 */

import {flattenCatalog, isLocaleMap, isTextRef, resolveLocaleMap, sanitizeParams} from "./index";
import type {Catalog, ReportTextProblem, Text, TextParams} from "./index";

export interface MinimalTranslatorOptions {
    /** 命名空间 → 语言 → 目录。 */
    readonly catalogs: Readonly<Record<string, Readonly<Record<string, Catalog>>>>;
    /** 命名空间的源语言；没写的按 `zh-CN`（内置插件与共享包的源语言）。 */
    readonly sources?: Readonly<Record<string, string>>;
    /** 测试环境为 true：缺键、缺插值参数时抛错（输出 4、6）。 */
    readonly strict?: boolean;
    readonly report?: ReportTextProblem;
}

export interface MinimalTranslator {
    translate(text: Text, locale: string): string;
    variants(text: Text): readonly string[];
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/gu;

export function createMinimalTranslator(options: MinimalTranslatorOptions): MinimalTranslator {
    const flat = new Map<string, Map<string, Readonly<Record<string, string>>>>();
    for (const [ns, byLocale] of Object.entries(options.catalogs)) {
        flat.set(ns, new Map(Object.entries(byLocale).map(([locale, catalog]) => [locale, flattenCatalog(catalog)])));
    }
    const reported = new Set<string>();
    const report: ReportTextProblem = (problem) => {
        const id = `${problem.kind}\u0000${problem.ns ?? ""}\u0000${problem.key}\u0000${problem.param ?? ""}`;
        if (reported.has(id)) return;
        reported.add(id);
        options.report?.(problem);
    };

    const chain = (ns: string | undefined, locale: string): readonly string[] => [...new Set([locale, options.sources?.[ns ?? ""] ?? "zh-CN", "en-US"])];
    const lookup = (ns: string | undefined, key: string, locales: readonly string[]): string | undefined => {
        const byLocale = flat.get(ns ?? "");
        for (const locale of locales) {
            const hit = byLocale?.get(locale)?.[key];
            if (hit !== undefined) return hit;
        }
        return undefined;
    };

    const translateRef = (ns: string | undefined, key: string, rawParams: TextParams | undefined, locale: string): string => {
        const params = sanitizeParams(rawParams, (param, kind) => report({kind, ns, key, param}));
        const locales = chain(ns, locale);
        const count = params["count"];
        let message: string | undefined;
        if (typeof count === "number") {
            // 输出 5：先按当前语言的复数类别取，再取 `_other`，最后才取不带后缀的键。
            message = lookup(ns, `${key}_${new Intl.PluralRules(locale).select(count)}`, locales) ?? lookup(ns, `${key}_other`, locales) ?? lookup(ns, key, locales);
        } else {
            if (rawParams !== undefined && "count" in rawParams) report({kind: "param-dropped", ns, key, param: "count"});
            message = lookup(ns, key, locales);
        }
        if (message === undefined) {
            if (options.strict === true) throw new Error(`Missing text key "${key}" in namespace "${ns ?? ""}"`);
            report({kind: "missing-key", ns, key});
            return key;
        }
        return message.replace(PLACEHOLDER, (placeholder, name: string) => {
            const value = params[name];
            if (value !== undefined) return String(value);
            if (options.strict === true) throw new Error(`Missing text param "${name}" for key "${key}" in namespace "${ns ?? ""}"`);
            report({kind: "missing-param", ns, key, param: name});
            return placeholder;
        });
    };

    return {
        translate(text, locale) {
            if (typeof text === "string") return text;
            if (isTextRef(text)) return translateRef(text.ns, text.key, text.params, locale);
            return isLocaleMap(text) ? resolveLocaleMap(text, locale) : "";
        },
        variants(text) {
            if (typeof text === "string") return [text];
            if (isTextRef(text)) {
                const byLocale = flat.get(text.ns ?? "");
                const found = [...(byLocale?.values() ?? [])].map((catalog) => catalog[text.key] ?? catalog[`${text.key}_other`]).filter((value): value is string => value !== undefined);
                return [...new Set(found)];
            }
            return isLocaleMap(text) ? [...new Set(Object.values(text))] : [];
        },
    };
}
