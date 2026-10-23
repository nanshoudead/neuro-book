/**
 * 组件的界面文字：中英两份，按宿主给的 `locale` 取。包不能引宿主的文字工具，这里是同样形状的最小一份；neuro-book 的
 * `DisplayLocale` 与 `MarkdownLocale` 相同（`packages/neuro-book/src/plugins/markdown/web/host.ts` 里有类型断言）。
 */

export type MarkdownLocale = "zh-CN" | "en-US";

export type MarkdownText = Readonly<Record<MarkdownLocale, string>>;

/** 按语言取一份，`{name}` 占位换成 `params` 里的值；没有的占位原样留着。 */
export function say(text: MarkdownText, locale: MarkdownLocale, params: Readonly<Record<string, string | number>> = {}): string {
    return text[locale].replace(/\{(\w+)\}/gu, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder));
}
