/**
 * 文字标记（docs/specs/workspace/markdown-dialect.md 输出 15、24）：文字颜色 `<span style="color: …">`、高亮 `<mark>` 与
 * `==文本==`、上标 `<sup>`、下标 `<sub>`。
 *
 * 标签与属性不合规定时（`style` 里有别的属性、颜色不合法、不带颜色的 `<span>`、上下标带属性）这里不认领，由原样语法读成原样片段。
 *
 * 写法属性 `markdown`：HTML 形式记开闭标签的原文与它表示的颜色（`{open, close, color}`），颜色没变时按原文写回（标签大小写、
 * 引号与空白不变）；高亮的 `==` 形式记 `"=="`。新建的颜色由界面写成 `#rrggbb`，这里按原样写出。
 */

import {Mark, mergeAttributes} from "@tiptap/core";
import type {Mark as PMMark} from "@tiptap/pm/model";
import type {MarkedExtension, Token, Tokens} from "marked";

import {escapeAttribute} from "../../../markdown-dialect";

import {leftFlanking, rightFlanking} from "../flanking";
import {closeInline, lastMatch, nextMatch, openTagAt, openTagIndex, skipInline} from "../tags";
import type {MarkdownSyntax, MarkWriter, TokenReader, WriteContext} from "../types";

/** CSS 的颜色名（CSS Color 4）。 */
const NAMED_COLORS = new Set(
    (
        "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
        "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
        "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
        "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
        "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral " +
        "lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
        "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple " +
        "mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite " +
        "navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink " +
        "plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
        "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
        "transparent"
    ).split(" "),
);

const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";
const PERCENT = `${NUMBER}%`;
const NUMBER_OR_PERCENT = `(?:${PERCENT}|${NUMBER}|none)`;
const HUE = `(?:${NUMBER}(?:deg|grad|rad|turn)?|none)`;
const ALPHA = `(?:${PERCENT}|${NUMBER}|none)`;
/**
 * `rgb()`/`rgba()` 与 `hsl()`/`hsla()` 的参数：逗号写法三个或四个，空格写法三个、可带 `/ 透明度`（CSS Color 4）。`var()`、
 * `calc()` 这类引用与参数个数不对的都不是。
 */
const RGB = new RegExp(`^rgba?\\(\\s*(?:${NUMBER_OR_PERCENT}\\s*,\\s*${NUMBER_OR_PERCENT}\\s*,\\s*${NUMBER_OR_PERCENT}(?:\\s*,\\s*${ALPHA})?|${NUMBER_OR_PERCENT}\\s+${NUMBER_OR_PERCENT}\\s+${NUMBER_OR_PERCENT}(?:\\s*\\/\\s*${ALPHA})?)\\s*\\)$`, "iu");
const HSL = new RegExp(`^hsla?\\(\\s*(?:${HUE}\\s*,\\s*${PERCENT}\\s*,\\s*${PERCENT}(?:\\s*,\\s*${ALPHA})?|${HUE}\\s+${NUMBER_OR_PERCENT}\\s+${NUMBER_OR_PERCENT}(?:\\s*\\/\\s*${ALPHA})?)\\s*\\)$`, "iu");

/** 合法的颜色值（输出 15）：`#` 十六进制、`rgb()`、`hsl()`（含带透明度的写法）与颜色名；不能是 `var()`、`url()` 这类引用。 */
export function isColor(value: string): boolean {
    const color = value.trim();
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(color)) return true;
    if (RGB.test(color) || HSL.test(color)) return true;
    return NAMED_COLORS.has(color.toLowerCase());
}

/** `style` 属性里只有一条 `属性: 颜色`（可带结尾的分号）时返回颜色，否则为 null。 */
function onlyColor(style: string | undefined, property: string): string | null {
    if (style === undefined) return null;
    const matched = new RegExp(`^\\s*${property}\\s*:\\s*([^;]+?)\\s*;?\\s*$`, "iu").exec(style);
    return matched !== null && isColor(matched[1] as string) ? (matched[1] as string) : null;
}

const style = {default: null, rendered: false, keepOnSplit: false};

export const MarkdownTextColor = Mark.create({
    name: "markdownTextColor",
    priority: 760,
    addAttributes() {
        return {color: {default: null, renderHTML: (attributes: {color?: string | null}) => (attributes.color ? {style: `color: ${attributes.color}`} : {})}, markdown: style};
    },
    parseHTML() {
        return [{tag: "span[style]", getAttrs: (dom) => ({color: onlyColor((dom as HTMLElement).getAttribute("style") ?? undefined, "color")})}];
    },
    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes), 0];
    },
});

export const MarkdownHighlight = Mark.create({
    name: "markdownHighlight",
    priority: 755,
    inclusive: false,
    addAttributes() {
        return {color: {default: null, renderHTML: (attributes: {color?: string | null}) => (attributes.color ? {style: `background-color: ${attributes.color}`} : {})}, markdown: style};
    },
    parseHTML() {
        return [{tag: "mark", getAttrs: (dom) => ({color: onlyColor((dom as HTMLElement).getAttribute("style") ?? undefined, "background-color")})}];
    },
    renderHTML({HTMLAttributes}) {
        return ["mark", mergeAttributes(HTMLAttributes), 0];
    },
});

export const MarkdownSuperscript = Mark.create({
    name: "markdownSuperscript",
    priority: 750,
    // 写了 `excludes` 就不再默认与同类互斥，自己也要列上。
    excludes: "markdownSubscript markdownSuperscript",
    addAttributes() {
        return {markdown: style};
    },
    parseHTML() {
        return [{tag: "sup"}];
    },
    renderHTML({HTMLAttributes}) {
        return ["sup", mergeAttributes(HTMLAttributes), 0];
    },
});

export const MarkdownSubscript = Mark.create({
    name: "markdownSubscript",
    priority: 750,
    excludes: "markdownSuperscript markdownSubscript",
    addAttributes() {
        return {markdown: style};
    },
    parseHTML() {
        return [{tag: "sub"}];
    },
    renderHTML({HTMLAttributes}) {
        return ["sub", mergeAttributes(HTMLAttributes), 0];
    },
});

/** 标签名 → 标记类型。 */
const TAG_MARKS: Readonly<Record<string, string>> = {span: "markdownTextColor", mark: "markdownHighlight", sup: "markdownSuperscript", sub: "markdownSubscript"};
const TAGS = Object.keys(TAG_MARKS);

interface TextMarkToken extends Tokens.Generic {
    readonly mark: string;
    readonly color: string | null;
    readonly open: string;
    readonly close: string;
    readonly tokens: Token[];
}

/** 开标签的属性合不合规定：返回颜色（没有颜色为 null），不合规定为 undefined。 */
function attributesOf(tag: string, attributes: ReadonlyMap<string, string>): string | null | undefined {
    const names = [...attributes.keys()];
    switch (tag) {
        case "span": {
            if (names.length !== 1 || names[0] !== "style") return undefined;
            return onlyColor(attributes.get("style"), "color") ?? undefined;
        }
        case "mark": {
            if (names.length === 0) return null;
            if (names.length !== 1 || names[0] !== "style") return undefined;
            return onlyColor(attributes.get("style"), "background-color") ?? undefined;
        }
        default:
            return names.length === 0 ? null : undefined;
    }
}

/** 已分出的行内单元的最后一个字符（`==` 开不开要看前一个字符）。 */
function previousChar(tokens: ReadonlyArray<Token>): string {
    const last = tokens.at(-1);
    return last === undefined ? "" : (last.raw.at(-1) ?? "");
}

/**
 * `==文本==`（输出 24）：两个等号，开闭按 CJK 友好的侧翼规则（与 `~~` 相同）；三个以上的等号不是高亮。闭合找第一个能闭的
 * `==`，跳过行内代码与转义。
 */
function equalsHighlight(src: string, tokens: ReadonlyArray<Token>): {raw: string; text: string} | null {
    if (!src.startsWith("==") || src[2] === "=") return null;
    if (!leftFlanking(previousChar(tokens), src[2] ?? "")) return null;
    // 后面没有前面不是空白的 `==`（能闭的必要条件）时直接返回。
    if (lastMatch(src, /[^\s=]==(?!=)/gu) < 2) return null;
    // 只停在可能有用的字符上（转义、行内代码、标签、等号），中间的一段用原生搜索跳过：一段里很多闭不上的 `==` 时，每个都逐字
    // 扫到段末会是平方级。
    const interesting = /[\\`<=]/gu;
    for (let index = 2; index < src.length; index += 1) {
        interesting.lastIndex = index;
        const next = interesting.exec(src);
        if (next === null) return null;
        index = next.index;
        const skipped = skipInline(src, index);
        if (skipped !== index) {
            index = skipped - 1;
            continue;
        }
        const char = src[index];
        if (char !== "=" || src[index + 1] !== "=" || src[index - 1] === "=" || src[index + 2] === "=") continue;
        if (index === 2 || !rightFlanking(src[index - 1] as string, src[index + 2] ?? "")) continue;
        return {raw: src.slice(0, index + 2), text: src.slice(2, index)};
    }
    return null;
}

const tokenizers: MarkedExtension = {
    extensions: [
        {
            name: "textMark",
            level: "inline",
            start: (src: string) => openTagIndex(src, TAGS),
            tokenizer(src: string): TextMarkToken | undefined {
                const open = openTagAt(src, TAGS);
                if (open === null) return undefined;
                const color = attributesOf(open.name, open.attributes);
                if (color === undefined) return undefined;
                const close = closeInline(src, open.name, open.length);
                // 里面是空的不认领：没有文字可以带这个标记，读成原样片段保住原文。
                if (close === null || close.start === open.length) return undefined;
                return {
                    type: "textMark",
                    raw: src.slice(0, close.end),
                    mark: TAG_MARKS[open.name] as string,
                    color,
                    open: open.raw,
                    close: src.slice(close.start, close.end),
                    tokens: this.lexer.inlineTokens(src.slice(open.length, close.start)),
                };
            },
        },
        {
            name: "equalsHighlight",
            level: "inline",
            start: (src: string) => nextMatch(src, /==/gu),
            tokenizer(src: string, tokens: Token[]) {
                const matched = equalsHighlight(src, tokens);
                return matched === null ? undefined : {type: "equalsHighlight", raw: matched.raw, tokens: this.lexer.inlineTokens(matched.text)};
            },
        },
    ],
};

const readInline: Readonly<Record<string, TokenReader>> = {
    textMark: (token, context) => {
        const value = token as TextMarkToken;
        const attrs: Record<string, unknown> = {markdown: {open: value.open, close: value.close, color: value.color}};
        if (value.mark === "markdownTextColor" || value.mark === "markdownHighlight") attrs.color = value.color;
        return context.mark(value.mark, context.inline(value.tokens), attrs);
    },
    equalsHighlight: (token, context) => context.mark("markdownHighlight", context.inline((token as Tokens.Generic & {tokens: Token[]}).tokens), {color: null, markdown: "=="}),
};

interface HtmlStyle {
    readonly open: string;
    readonly close: string;
    readonly color: string | null;
}

/** HTML 形式的标记：按原文的开闭标签写（颜色没变时），否则写规范的标签。 */
function htmlMark(tag: string, canonicalOpen: (mark: PMMark) => string): MarkWriter {
    const kept = (mark: PMMark, context: WriteContext): HtmlStyle | null => {
        const value = context.style<HtmlStyle | string>(mark);
        if (value === null || typeof value === "string") return null;
        return (value.color ?? null) === ((mark.attrs.color as string | null | undefined) ?? null) ? value : null;
    };
    return {
        open: (mark, context) => kept(mark, context)?.open ?? canonicalOpen(mark),
        close: (mark, context) => kept(mark, context)?.close ?? `</${tag}>`,
    };
}

const highlightHtml = htmlMark("mark", (mark) => (mark.attrs.color === null || mark.attrs.color === undefined ? "<mark>" : `<mark style="background-color: ${escapeAttribute(String(mark.attrs.color))}">`));

const writeMark: Readonly<Record<string, MarkWriter>> = {
    markdownTextColor: htmlMark("span", (mark) => `<span style="color: ${escapeAttribute(String(mark.attrs.color ?? ""))}">`),
    markdownHighlight: {
        // `==` 两端的空白会让它开不了、闭不了：与强调一样把空白移到外面（HTML 形式不受影响，比较时两边一样处理）。
        emphasis: true,
        open: (mark, context, run) => (context.style(mark) === "==" && mark.attrs.color === null ? "==" : highlightHtml.open(mark, context, run)),
        close: (mark, context, run) => (context.style(mark) === "==" && mark.attrs.color === null ? "==" : highlightHtml.close(mark, context, run)),
    },
    markdownSuperscript: htmlMark("sup", () => "<sup>"),
    markdownSubscript: htmlMark("sub", () => "<sub>"),
};

export const textMarksSyntax: MarkdownSyntax = {
    name: "text-marks",
    extensions: [MarkdownTextColor, MarkdownHighlight, MarkdownSuperscript, MarkdownSubscript],
    marked: [tokenizers],
    readInline,
    writeMark,
    inlineTags: TAGS,
};
