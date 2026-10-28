/**
 * 宿主交给组件的文字（docs/specs/ui/i18n.md）：nb-ui 的文字值，字符串、目录里的键（`TextRef`）或按语言给出的几份。
 * 本模块属于纯 TS 入口，只依赖 nb-ui 的纯数据层：`TextRef` 在这里翻译不了（没有目录），由组件经翻译端口翻译
 * （`host/text.ts`）。本包自己的界面文字在 `./locales` 的目录里。
 *
 * neuro-book 的 `DisplayLocale` 与 `MarkdownLocale` 相同（`packages/neuro-book/src/plugins/markdown/web/host.ts` 里有类型断言）。
 */

import {isTextRef, resolveLocaleMap} from "@notnotype/nb-ui/text";
import type {Text} from "@notnotype/nb-ui/text";

export type MarkdownLocale = string;

export type MarkdownText = Text;

/** 字符串与语言映射里的单花括号占位 `{name}`（目录用 `{{name}}`，由翻译端口代入）。 */
export function fillBraces(text: string, params: Readonly<Record<string, string | number>>): string {
    return text.replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}

/**
 * 按语言取一份，`{name}` 占位换成 `params` 里的值；没有的占位原样留着。语言映射取不到当前语言时按 `resolveLocaleMap`
 * 回退。`TextRef` 这里翻译不了，返回它的键名（组件经端口翻译，不走这里）。
 */
export function say(text: MarkdownText, locale: MarkdownLocale, params: Readonly<Record<string, string | number>> = {}): string {
    if (typeof text === "string") return fillBraces(text, params);
    if (isTextRef(text)) return text.key;
    return fillBraces(resolveLocaleMap(text, locale), params);
}
