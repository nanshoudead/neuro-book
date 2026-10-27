/**
 * 组件的界面文字：中英两份，按宿主给的 `locale` 取。包不能引宿主的文字工具，这里是同样形状的最小一份；neuro-book 的
 * `DisplayLocale` 与 `MarkdownLocale` 相同（`packages/neuro-book/src/plugins/markdown/web/host.ts` 里有类型断言）。
 * 语言是字符串（docs/specs/ui/i18n.md）；本包的文字表仍要求两种语言都写，取不到当前语言时按 `resolveLocaleMap` 回退。
 */

import {resolveLocaleMap} from "@notnotype/nb-ui/text";

export type MarkdownLocale = string;

export type MarkdownText = Readonly<{"zh-CN": string; "en-US": string}>;

/** 按语言取一份，`{name}` 占位换成 `params` 里的值；没有的占位原样留着。 */
export function say(text: MarkdownText, locale: MarkdownLocale, params: Readonly<Record<string, string | number>> = {}): string {
    return resolveLocaleMap(text, locale).replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}
