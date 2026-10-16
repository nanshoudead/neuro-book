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
import type {MarkedExtension, Token, Tokens} from "marked";

import {FOOTNOTE_REF_SOURCE, LONE_TAG, MATH_INLINE_SOURCE, OPENS_HTML_BLOCK, READABLE_INLINE_HTML, VOID_HTML_TAGS} from "nbook/shared/markdown-dialect";

import {encodeRawBreaks} from "../../codec/render/escape";
import {lastMatch, nextMatch, paragraphEnd} from "../tags";
import type {MarkdownSyntax, TokenReader} from "../types";
import {Unrepresentable} from "../types";

// 标签名后面紧跟空白、`/` 或 `>`：`<https://例子>`、`<a@b.cn>` 是自动链接，不是标签。
const OPEN_TAG = /^<([a-zA-Z][\w-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/u;
const SELF_CLOSING = /^<([a-zA-Z][\w-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>"'])*\/>/u;
const CLOSE_TAG = /^<\/([a-zA-Z][\w-]*)\s*>/u;

/** 同名标签嵌套计数下，从 `from` 起找配对的闭标签，返回它的结束位置；没有返回 -1。 */
function matchingCloseEnd(src: string, tag: string, from: number): number {
    // 后面根本没有这个名字的闭标签时直接返回（原生搜索）：一段里成千上万个没闭合的 `<a>` 不至于每个都逐个数到段末。
    if (lastMatch(src, new RegExp(`</${tag}\\s*>`, "giu")) < from) return -1;
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
        if (VOID_HTML_TAGS.has(tag)) captured = open[0];
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
const FOOTNOTE_REF = new RegExp(`^${FOOTNOTE_REF_SOURCE}`, "u");
const MATH_INLINE = new RegExp(`^(?:${MATH_INLINE_SOURCE})`, "u");
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
                // `marked` 遇到标签已在定义表里的定义（同名的第二条，或读法另作分词时整篇的定义表里已经有它）既不产出单元，
                // 也不并进别的单元，原文就丢了。这里在它之前把这种定义作为定义单元产出（读成原样块）。紧跟在段落后面的定义
                // 由 `marked` 并进段落，不管。
                name: "duplicateDefinition",
                level: "block",
                tokenizer(src: string, tokens: Token[]) {
                    const last = tokens.at(-1);
                    if (last?.type === "paragraph" || last?.type === "text") return undefined;
                    const definition = (this.lexer as unknown as {tokenizer: {def(src: string): Tokens.Def | undefined}}).tokenizer.def(src);
                    if (definition === undefined || this.lexer.tokens.links[definition.tag] === undefined) return undefined;
                    return {...definition, type: "def"};
                },
            },
            {
                name: "rawHtmlBlock",
                level: "block",
                // 只认“换行后的行首标签”：`marked` 判段落中断时传入 `src.slice(1)`，匹配开头会把段内的行内标签误当成断点。
                start(src: string) {
                    // 只在这一段里找（正则 `exec` 找不到时会一直扫到文末）。
                    const paragraph = src.slice(0, paragraphEnd(src));
                    const pattern = /\n<([a-zA-Z][\w-]*)/gu;
                    for (let matched = pattern.exec(paragraph); matched !== null; matched = pattern.exec(paragraph)) {
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
                    const at = src.slice(0, paragraphEnd(src)).search(/\n\[\^[^\]\s]+\]:/u);
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
                    const at = src.slice(0, paragraphEnd(src)).search(/\n\$\$/u);
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
                start: (src: string) => nextMatch(src, /<\/?[a-zA-Z]/gu),
                tokenizer(src: string) {
                    const raw = completeHtml(src, readableInline, false) ?? htmlFragment(src, readableInline);
                    return raw === null ? undefined : {type: "rawHtmlInline", raw};
                },
            },
            {
                name: "footnoteRef",
                level: "inline",
                start: (src: string) => nextMatch(src, /\[\^/gu),
                tokenizer(src: string) {
                    const matched = FOOTNOTE_REF.exec(src);
                    return matched === null ? undefined : {type: "footnoteRef", raw: matched[0]};
                },
            },
            {
                name: "mathInline",
                level: "inline",
                start: (src: string) => nextMatch(src, /\$/gu),
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
        joinedInline: {rawInline: "raw"},
        // 原样内容自带的换行带上标记写出（见 `codec/render/escape.ts` 的 `encodeRawBreaks`）。
        writeBlock: {rawBlock: (node) => encodeRawBreaks(String(node.attrs.raw ?? ""))},
        writeInline: {
            // 段首就是会开启 HTML 块的原样片段、或者整段只有一个完整标签时写不出（方言 Spec 输出 9）：它会被读成原样块。
            // 后面跟着换行的情况由换行的写法处理（写成 `<br>`，标签不独占一行）。
            rawInline: (node, _context, around) => {
                const raw = String(node.attrs.raw ?? "");
                if (around.previous === null && around.place.table !== true && (OPENS_HTML_BLOCK.test(raw) || (around.next === null && LONE_TAG.test(raw)))) throw new Unrepresentable("段首的 HTML 会被读成 HTML 块");
                return encodeRawBreaks(raw);
            },
        },
    };
}
