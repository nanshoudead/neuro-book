/**
 * 原样块与原样片段（docs/specs/workspace/markdown-dialect.md 输出 9）：NeuroBook 认不出、或编辑器表达不了的语法，读进来显示源码，
 * 可以整体删除、复制，写回时字节不变。节点只持有原文字节（`raw` 属性），读入时由调度器从原文切出，不用规范化后的文字。
 *
 * 认领的范围：方言之外的 HTML（块级片段、行内标签与残片；判据沿用旧的 HtmlFallback）、HTML 注释、引用定义、脚注的引用与定义、
 * 数学（`$…$` 按 Pandoc 的规则，`$$` 块）。分块时对不上任何词法单元的原文、不合 schema 的块也由调度器读成原样块。
 *
 * 分词规则最先登记、最后试（见 `language.ts`），方言标签的合法形态都由各自模块先认领；这里再用标签名单挡一道，
 * 登记顺序出错时也不会抢走方言标签。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkedExtension} from "marked";

import type {MarkdownSyntax, TokenReader} from "../types";

/** 能读的行内 HTML（输出 25）：交给核心语法配对成粗体、斜体、删除线与换行，这里不抢。 */
export const READABLE_INLINE_HTML = ["strong", "b", "em", "i", "del", "s", "br"] as const;

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const OPEN_TAG = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/u;
const SELF_CLOSING = /^<([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*\/>/u;
const CLOSE_TAG = /^<\/([a-zA-Z][\w-]*)\s*>/u;

/** 同名标签嵌套计数下，从 `from` 起找配对的闭标签，返回它的结束位置；没有返回 -1。 */
function matchingCloseEnd(src: string, tag: string, from: number): number {
    const pattern = new RegExp(`<(/?)${tag}(?=[\\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "giu");
    pattern.lastIndex = from;
    let depth = 1;
    for (let matched = pattern.exec(src); matched !== null; matched = pattern.exec(src)) {
        if ((matched[2] ?? "").endsWith("/")) continue;
        depth += matched[1] === "/" ? -1 : 1;
        if (depth === 0) return matched.index + matched[0].length;
    }
    return -1;
}

/** 从开头捕获一段完整的、不在 `known` 里的 HTML 片段；`lineEnd` 要求片段后面紧跟行尾（块级形态）。 */
function completeHtml(src: string, known: ReadonlySet<string>, lineEnd: boolean): string | null {
    let captured: string | null = null;
    const selfClosing = SELF_CLOSING.exec(src);
    if (selfClosing !== null) {
        captured = known.has((selfClosing[1] as string).toLowerCase()) ? null : selfClosing[0];
    } else {
        const open = OPEN_TAG.exec(src);
        if (open === null) return null;
        const tag = (open[1] as string).toLowerCase();
        if (known.has(tag)) return null;
        if (VOID_TAGS.has(tag)) captured = open[0];
        else {
            const end = matchingCloseEnd(src, tag, open[0].length);
            captured = end < 0 ? null : src.slice(0, end);
        }
    }
    if (captured === null) return null;
    if (lineEnd && !/^[ \t]*(?:\n|$)/u.test(src.slice(captured.length))) return null;
    return captured;
}

/** 行内残片：孤立的闭标签或没闭合的开标签本身（`Vec<String>` 这类伪标签也在这里保住）。 */
function htmlFragment(src: string, known: ReadonlySet<string>): string | null {
    const close = CLOSE_TAG.exec(src);
    if (close !== null) return known.has((close[1] as string).toLowerCase()) ? null : close[0];
    const open = OPEN_TAG.exec(src);
    if (open !== null && !known.has((open[1] as string).toLowerCase())) return open[0];
    return null;
}

/** 脚注定义：`[^标签]: 文字`，后面缩进的行是它的续行。 */
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:[^\n]*(?:\n(?:[ \t]+[^\n]*|[ \t]*(?=\n[ \t]+\S)))*/u;
const FOOTNOTE_REF = /^\[\^[^\]\s]+\]/u;
/** 行内数学（Pandoc 的 tex_math_dollars）：开 `$` 后不是空白，闭 `$` 前不是空白、后面不是数字。 */
const MATH_INLINE = /^\$(?=\S)(?:\\.|[^$\\\n])*?\S\$(?!\d)|^\$[^\s$]\$(?!\d)/u;
const MATH_BLOCK = /^\$\$[^\n]*\$\$[ \t]*(?=\n|$)|^\$\$[ \t]*\n[\s\S]*?\n[ \t]*\$\$[ \t]*(?=\n|$)/u;

export const RawBlock = Node.create({
    name: "rawBlock",
    group: "block",
    atom: true,
    selectable: true,
    // 低于段落：空文档与空容器的默认填充必须是段落（ProseMirror 取 schema 里第一个能默认创建的块）。
    priority: 50,
    addAttributes() {
        return {raw: {default: "", rendered: false}};
    },
    parseHTML() {
        return [{tag: "pre[data-nb-raw-block]", getAttrs: (dom) => ({raw: (dom as HTMLElement).textContent ?? ""})}];
    },
    renderHTML({node}) {
        return ["pre", mergeAttributes({class: "nb-html-block", "data-nb-raw-block": "", contenteditable: "false"}), String(node.attrs.raw ?? "")];
    },
    renderText({node}) {
        return String(node.attrs.raw ?? "");
    },
});

export const RawInline = Node.create({
    name: "rawInline",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    priority: 50,
    addAttributes() {
        return {raw: {default: "", rendered: false}};
    },
    parseHTML() {
        return [{tag: "span[data-nb-raw-inline]", getAttrs: (dom) => ({raw: (dom as HTMLElement).getAttribute("data-nb-raw-inline") ?? ""})}];
    },
    renderHTML({node}) {
        const raw = String(node.attrs.raw ?? "");
        return ["span", mergeAttributes({class: "nb-raw-inline-html", "data-nb-raw-inline": raw, contenteditable: "false", title: raw}), raw];
    },
    renderText({node}) {
        return String(node.attrs.raw ?? "");
    },
});

/**
 * 原样语法。`blockTags`、`inlineTags` 是全部方言的标签名：它们的合法形态由各自模块认领，残片才落到这里。
 */
export function createRawSyntax(tags: {readonly blockTags: ReadonlyArray<string>; readonly inlineTags: ReadonlyArray<string>}): MarkdownSyntax {
    const readableInline = new Set<string>(READABLE_INLINE_HTML);
    // 块级兜底不抢：块级方言、能读的行内 HTML、行内方言（`<ruby text="x">汉</ruby>` 单独成段时不能被整段吃成源码块）。
    const blockKnown = new Set<string>([...tags.blockTags, ...READABLE_INLINE_HTML, ...tags.inlineTags]);
    const block: TokenReader = (token, context) => [context.raw(token, false)];
    const inline: TokenReader = (token, context) => [context.raw(token, true)];
    const marked: MarkedExtension = {
        extensions: [
            {
                name: "rawHtmlBlock",
                level: "block",
                // 只认“换行后的行首标签”：`marked` 判段落中断时传入 `src.slice(1)`，匹配开头会把段内的行内标签误当成断点。
                start(src: string) {
                    const pattern = /\n<([a-zA-Z][\w-]*)/gu;
                    for (let matched = pattern.exec(src); matched !== null; matched = pattern.exec(src)) {
                        if (!blockKnown.has((matched[1] as string).toLowerCase())) return matched.index + 1;
                    }
                    return -1;
                },
                tokenizer(src: string) {
                    const raw = completeHtml(src, blockKnown, true);
                    return raw === null ? undefined : {type: "rawHtmlBlock", raw};
                },
            },
            {
                name: "footnoteDef",
                level: "block",
                start: (src: string) => {
                    const at = src.search(/\n\[\^[^\]\s]+\]:/u);
                    return at < 0 ? -1 : at + 1;
                },
                tokenizer(src: string) {
                    const matched = FOOTNOTE_DEF.exec(src);
                    return matched === null ? undefined : {type: "footnoteDef", raw: matched[0]};
                },
            },
            {
                name: "mathBlock",
                level: "block",
                start: (src: string) => {
                    const at = src.search(/\n\$\$/u);
                    return at < 0 ? -1 : at + 1;
                },
                tokenizer(src: string) {
                    const matched = MATH_BLOCK.exec(src);
                    return matched === null ? undefined : {type: "mathBlock", raw: matched[0]};
                },
            },
            {
                name: "rawHtmlInline",
                level: "inline",
                start: (src: string) => src.search(/<\/?[a-zA-Z]/u),
                tokenizer(src: string) {
                    const raw = completeHtml(src, readableInline, false) ?? htmlFragment(src, readableInline);
                    return raw === null ? undefined : {type: "rawHtmlInline", raw};
                },
            },
            {
                name: "footnoteRef",
                level: "inline",
                start: (src: string) => src.indexOf("[^"),
                tokenizer(src: string) {
                    const matched = FOOTNOTE_REF.exec(src);
                    return matched === null ? undefined : {type: "footnoteRef", raw: matched[0]};
                },
            },
            {
                name: "mathInline",
                level: "inline",
                start: (src: string) => src.indexOf("$"),
                tokenizer(src: string) {
                    const matched = MATH_INLINE.exec(src);
                    return matched === null ? undefined : {type: "mathInline", raw: matched[0]};
                },
            },
        ],
    };
    return {
        name: "raw",
        extensions: [RawBlock, RawInline],
        marked: [marked],
        read: {
            rawHtmlBlock: block,
            footnoteDef: block,
            mathBlock: block,
            def: block,
            // 块级 HTML：注释与 `marked` 认出的各类 HTML 块。
            html: block,
        },
        readInline: {
            rawHtmlInline: inline,
            footnoteRef: inline,
            mathInline: inline,
            // 能读的行内 HTML 已由核心语法整体认领，落到这里的是 HTML 注释与配不上对的标签。
            html: inline,
        },
    };
}
