/**
 * 界面文本的中英两份。插件把要显示的文本直接写进声明（例如命令标题），声明来自代码也来自以后的清单 JSON，
 * 两种来源都不经过翻译表；界面按显示语言取其中一份。
 */

import {isTextRef, resolveLocaleMap} from "@notnotype/nb-ui/text";
import type {LocaleMap, Text} from "@notnotype/nb-ui/text";
import type {TextPort} from "@notnotype/nb-ui/text-port";
import {Type} from "typebox";
import type {Static} from "typebox";

export const LocalizedTextSchema = Type.Object({
    "zh-CN": Type.String({pattern: "\\S"}),
    "en-US": Type.String({pattern: "\\S"}),
}, {additionalProperties: false});

export type LocalizedText = Static<typeof LocalizedTextSchema>;

/**
 * 显示语言的标签（docs/specs/ui/i18n.md）。是字符串而不是两种语言的联合：加一种界面语言只改宿主的语言集合与目录，
 * 不改各处的类型。界面语言集合见 `HOST_LOCALES`。
 */
export type DisplayLocale = string;

/**
 * 界面上要显示的文字：中英两份，或与语言无关的字符串（路径、项目名）。显示时才按当前语言取，语言切换后已打开的
 * 面板与提示随之换文字；不要提前折成字符串快照。当前语言是配置项 `nbook.settings/locale`。
 */
export type DisplayText = Text;

/** 把声明里的 `Text` 解析成当前语言字符串；纯 TS 函数收它，不收语言标签（`TextRef` 要查窗口的目录）。 */
export type TextResolver = Pick<TextPort, "t" | "variants">;

/** 只含字符串与语言映射的文字（代码里写死的那种）按语言取一份；可能含 `TextRef` 的声明文字用 `TextResolver.t`。 */
export function textOf(text: string | LocaleMap, locale: DisplayLocale): string {
    return typeof text === "string" ? text : resolveLocaleMap(text, locale);
}

/**
 * 把文字值写进诊断（命令失败记进诊断、Lab 的检视这类给开发者看的地方，手边没有翻译端口）：字符串原样，语言映射取中文
 * （按 docs/specs/ui/i18n.md 输出 2 回退），文字引用写成 `命名空间:键` 加参数，不翻译。界面上的文字用 `TextResolver.t`。
 */
export function diagnosticText(text: Text): string {
    if (typeof text === "string") return text;
    if (!isTextRef(text)) return resolveLocaleMap(text, "zh-CN");
    return `${text.ns ?? ""}:${text.key}${text.params === undefined ? "" : ` ${JSON.stringify(text.params)}`}`;
}

/**
 * 组件还收着 `locale` 属性的过渡期写法：语言映射与字符串按 `locale()` 取，`TextRef` 交窗口的端口（目录在宿主那边）。
 * `locale()` 在每次解析时才读，所以在 computed 或渲染里用时仍随语言切换重新求值。
 */
export function resolverFor(locale: () => DisplayLocale, port: TextResolver): TextResolver {
    return {t: (text) => (isTextRef(text) ? port.t(text) : textOf(text, locale())), variants: port.variants};
}
