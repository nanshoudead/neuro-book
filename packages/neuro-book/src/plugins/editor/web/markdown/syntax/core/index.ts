/**
 * 核心语法（docs/specs/workspace/markdown-dialect.md 输出 2、4–7、10、19、20、25、26）：CommonMark 与 GFM 的块与行内语法。
 *
 * schema 用 Tiptap 的扩展；读法全部自己写，不用扩展自带的 `parseMarkdown`：要从词法单元的 `raw` 记下原来的写法（`markdown`
 * 属性），要按自己的规则处理实体、段内换行与行内 HTML。
 *
 * 写法属性 `markdown` 不渲染到 DOM、不随拆分复制（`keepOnSplit: false`）；值的形状见各读法。新建的节点没有它，写出时用规范写法。
 */

import {Extension} from "@tiptap/core";
import type {AnyExtension, JSONContent} from "@tiptap/core";
import {Image} from "@tiptap/extension-image";
import {Link} from "@tiptap/extension-link";
import {TaskItem, TaskList} from "@tiptap/extension-list";
import {Paragraph} from "@tiptap/extension-paragraph";
import {TableCell, TableHeader, TableKit} from "@tiptap/extension-table";
import {StarterKit} from "@tiptap/starter-kit";
import {decodeHTMLStrict} from "entities";
import type {MarkedExtension, Token, Tokens} from "marked";
import markedCjkFriendly from "marked-cjk-friendly";

import type {MarkdownSyntax, ReadContext, TokenReader} from "../types";


/** 需要记写法的节点与标记类型。 */
const STYLED_TYPES = [
    "heading", "bulletList", "orderedList", "taskItem", "codeBlock", "horizontalRule", "hardBreak", "image",
    "bold", "italic", "strike", "code", "link",
];

/** `markdown` 写法属性：不画到 DOM，不随拆分带到新节点。 */
const MarkdownStyle = Extension.create({
    name: "markdownStyle",
    addGlobalAttributes() {
        return [{types: STYLED_TYPES, attributes: {markdown: {default: null, rendered: false, keepOnSplit: false}}}];
    },
});

/**
 * 段落的优先级压过所有块级节点：空文档、空容器的默认填充（ProseMirror 取 schema 里第一个能默认创建的块）必须是段落。
 * 新增块级节点的优先级不能超过它。
 */
const MarkdownParagraph = Paragraph.extend({priority: 1500});

/** 表格单元格只有一段（输出 20）：单元格里的 Enter 是换行，GFM 写不出多段。 */
const SingleParagraphCell = TableCell.extend({content: "paragraph"});
const SingleParagraphHeader = TableHeader.extend({content: "paragraph"});

/** 删除线只认两个波浪线（输出 7）：单个 `~` 交回成普通文字。 */
const doubleTildeOnly: MarkedExtension = {
    tokenizer: {
        del(src: string) {
            if (src.startsWith("~") && !src.startsWith("~~")) return {type: "text", raw: "~", text: "~"} as unknown as Tokens.Del;
            return false;
        },
    },
};

const text = (value: string): JSONContent => ({type: "text", text: value});

/** 文字单元：实体按 HTML5 表解码一次（含数字实体）；段内的换行读成带写法的硬换行（输出 5）。 */
function readText(raw: string): JSONContent[] {
    const out: JSONContent[] = [];
    const lines = raw.split("\n");
    lines.forEach((line, index) => {
        if (index > 0) out.push({type: "hardBreak", attrs: {markdown: "newline"}});
        if (line !== "") out.push(text(decodeHTMLStrict(line)));
    });
    return out;
}

/** 行内 HTML 能读的标签（输出 25）：标签名 → 标记类型。 */
const HTML_MARKS: Readonly<Record<string, string>> = {strong: "bold", b: "bold", em: "italic", i: "italic", del: "strike", s: "strike"};
const HTML_MARK_OPEN = /^<(strong|b|em|i|del|s)\s*>/iu;
const HTML_BREAK = /^<br\s*\/?>/iu;

/** 同名标签嵌套计数下找配对的闭标签，返回闭标签开始与结束的位置；没有为 null。 */
function closingTag(src: string, tag: string, from: number): {start: number; end: number} | null {
    const pattern = new RegExp(`<(/?)${tag}\\s*>`, "giu");
    pattern.lastIndex = from;
    let depth = 1;
    for (let matched = pattern.exec(src); matched !== null; matched = pattern.exec(src)) {
        depth += matched[1] === "/" ? -1 : 1;
        if (depth === 0) return {start: matched.index, end: matched.index + matched[0].length};
    }
    return null;
}

/**
 * HTML 形式的强调与换行（输出 25）整体认领成一个单元：`<strong>…</strong>` 连同里面的行内内容，`<br>`。配不上对的标签不认领，
 * 交给原样语法读成原样片段。行内内容用 `inlineTokens`：行内分词发生在全篇块分词之后，这时引用定义已经收齐。
 */
const htmlInline: MarkedExtension = {
    extensions: [
        {
            name: "htmlMark",
            level: "inline",
            start: (src: string) => src.search(/<(?:strong|b|em|i|del|s)\s*>/iu),
            tokenizer(src: string) {
                const open = HTML_MARK_OPEN.exec(src);
                if (open === null) return undefined;
                const tag = (open[1] as string).toLowerCase();
                const close = closingTag(src, tag, open[0].length);
                if (close === null) return undefined;
                return {type: "htmlMark", raw: src.slice(0, close.end), tag, tokens: this.lexer.inlineTokens(src.slice(open[0].length, close.start))};
            },
        },
        {
            name: "htmlBreak",
            level: "inline",
            start: (src: string) => src.search(/<br\s*\/?>/iu),
            tokenizer(src: string) {
                const matched = HTML_BREAK.exec(src);
                return matched === null ? undefined : {type: "htmlBreak", raw: matched[0]};
            },
        },
    ],
};

/** 强调符号：`**`、`__`、`*`、`_` 的第一个字符。 */
const emphasisMarker = (raw: string): string => (raw.startsWith("_") ? "_" : "*");

/** 链接的写法：行内、引用式（含折叠 `[a][]` 与简写 `[a]`）、尖括号自动链接、裸网址。 */
function linkStyle(token: Tokens.Link): Record<string, unknown> {
    const raw = token.raw;
    if (raw.startsWith("<")) return {style: "angle"};
    if (!raw.startsWith("[") && !raw.startsWith("!")) return {style: "bare"};
    const body = raw.startsWith("!") ? raw.slice(1) : raw;
    const reference = /^\[(?:\\.|[^\]\\])*\](?:\[([^\]]*)\])?$/u.exec(body);
    if (reference !== null) {
        if (reference[1] === undefined) return {style: "shortcut"};
        return reference[1] === "" ? {style: "collapsed"} : {style: "reference", label: reference[1]};
    }
    return {style: "inline", angle: /\]\(\s*</u.test(body)};
}

const inlineReaders: Readonly<Record<string, TokenReader>> = {
    text: (token, context) => {
        const value = token as Tokens.Text;
        return value.tokens !== undefined && value.tokens.length > 0 ? context.inline(value.tokens) : readText(value.raw);
    },
    escape: (token) => [text((token as Tokens.Escape).text)],
    br: (token) => [{type: "hardBreak", attrs: {markdown: token.raw.startsWith("\\") ? "backslash" : "spaces"}}],
    strong: (token, context) => context.mark("bold", context.inline((token as Tokens.Strong).tokens), {markdown: emphasisMarker(token.raw).repeat(2)}),
    em: (token, context) => context.mark("italic", context.inline((token as Tokens.Em).tokens), {markdown: emphasisMarker(token.raw)}),
    del: (token, context) => context.mark("strike", context.inline((token as Tokens.Del).tokens), {markdown: "~~"}),
    codespan: (token, context) => {
        const ticks = /^`+/u.exec(token.raw)?.[0].length ?? 1;
        return context.mark("code", [text((token as Tokens.Codespan).text)], {markdown: ticks});
    },
    link: (token, context) => {
        const link = token as Tokens.Link;
        return context.mark("link", context.inline(link.tokens), {href: link.href, title: link.title ?? null, markdown: linkStyle(link)});
    },
    image: (token) => {
        const image = token as Tokens.Image;
        return [{type: "image", attrs: {src: image.href, alt: image.text, title: image.title ?? null, markdown: linkStyle(image as unknown as Tokens.Link)}}];
    },
    // 有序列表里的 `1. [ ] 事项` 不是任务项（输出 19）：复选框按文字读回。
    checkbox: (token) => [text(token.raw)],
    htmlMark: (token, context) => {
        const value = token as Tokens.Generic & {tag: string; tokens: Token[]};
        return context.mark(HTML_MARKS[value.tag] as string, context.inline(value.tokens), {markdown: value.raw.slice(1, 1 + value.tag.length)});
    },
    htmlBreak: () => [{type: "hardBreak", attrs: {markdown: "br"}}],
};

/** 标题的写法：`#` 式（含结尾的 `#`）或下划线式（`=`、`-`）。 */
function headingStyle(raw: string): Record<string, unknown> {
    const trimmed = raw.replace(/\n+$/u, "");
    if (/^ {0,3}#/u.test(trimmed)) {
        const closing = /[ \t]+(#+)[ \t]*$/u.exec(trimmed)?.[1];
        return closing === undefined ? {style: "atx"} : {style: "atx", closing};
    }
    return {style: "setext", char: trimmed.endsWith("=") ? "=" : "-"};
}

/** 列表的写法：符号、有序分隔符与编号方式（全同一个数或按顺序）、松紧。 */
function listStyle(list: Tokens.List, items: ReadonlyArray<Tokens.ListItem>): Record<string, unknown> {
    const first = items[0]?.raw ?? "";
    if (!list.ordered) return {marker: /^\s*([-*+])/u.exec(first)?.[1] ?? "-", loose: list.loose};
    const numbers = items.map((item) => Number(/^\s*(\d+)/u.exec(item.raw)?.[1] ?? "1"));
    const same = numbers.length > 1 && numbers.every((value) => value === numbers[0]);
    return {delimiter: /^\s*\d+([.)])/u.exec(first)?.[1] ?? ".", numbering: same ? "same" : "sequential", loose: list.loose};
}

function readListItem(item: Tokens.ListItem, context: ReadContext): JSONContent[] {
    const content = context.blocks(item.tokens.filter((token) => token.type !== "checkbox"));
    return content.length > 0 ? content : [{type: "paragraph"}];
}

/**
 * 有序列表里的 `1. [ ] 事项` 不是任务项（输出 19）：`marked` 仍把复选框拆成单独的单元，这里把它的文字放回第一段的开头。
 */
function readOrderedItem(item: Tokens.ListItem, context: ReadContext): JSONContent[] {
    const checkbox = item.tokens.find((token) => token.type === "checkbox");
    const content = readListItem(item, context);
    if (checkbox === undefined) return content;
    const [first, ...rest] = content;
    if (first?.type !== "paragraph") return [{type: "paragraph", content: [text(checkbox.raw)]}, ...content];
    return [{...first, content: [text(checkbox.raw), ...(first.content ?? [])]}, ...rest];
}

/** 列表：任务项与普通项混在一起时拆成相邻的任务列表与普通列表；有序列表里的任务项按文字读。 */
const readList: TokenReader = (token, context) => {
    const list = token as Tokens.List;
    if (list.ordered) {
        return [{
            type: "orderedList",
            attrs: {start: typeof list.start === "number" ? list.start : 1, markdown: listStyle(list, list.items)},
            content: list.items.map((item) => ({type: "listItem", content: readOrderedItem(item, context)})),
        }];
    }
    const groups: Array<{task: boolean; items: Tokens.ListItem[]}> = [];
    for (const item of list.items) {
        const task = item.task === true;
        const last = groups.at(-1);
        if (last !== undefined && last.task === task) last.items.push(item);
        else groups.push({task, items: [item]});
    }
    return groups.map(({task, items}) => {
        if (!task) {
            return {type: "bulletList", attrs: {markdown: listStyle(list, items)}, content: items.map((item) => ({type: "listItem", content: readListItem(item, context)}))};
        }
        return {
            type: "taskList",
            content: items.map((item) => ({
                type: "taskItem",
                attrs: {checked: item.checked === true, markdown: {marker: /^\s*([-*+])/u.exec(item.raw)?.[1] ?? "-", check: /\[([xX ])\]/u.exec(item.raw)?.[1] ?? " "}},
                content: readListItem(item, context),
            })),
        };
    });
};

const blockReaders: Readonly<Record<string, TokenReader>> = {
    paragraph: (token, context) => [{type: "paragraph", content: context.inline((token as Tokens.Paragraph).tokens)}],
    heading: (token, context) => {
        const heading = token as Tokens.Heading;
        return [{type: "heading", attrs: {level: heading.depth, markdown: headingStyle(heading.raw)}, content: context.inline(heading.tokens)}];
    },
    blockquote: (token, context) => {
        const content = context.blocks((token as Tokens.Blockquote).tokens);
        return [{type: "blockquote", content: content.length > 0 ? content : [{type: "paragraph"}]}];
    },
    list: readList,
    code: (token) => {
        const code = token as Tokens.Code;
        const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(code.raw)?.[1];
        const lines = code.raw.replace(/\n+$/u, "").split("\n");
        const closing = new RegExp(`^ {0,3}${fence?.[0] ?? "`"}{${fence?.length ?? 3},}[ \\t]*$`, "u");
        // 没闭合的围栏（读到文末）记下来：重新写出时要不要补上闭合，由写出与读回校验决定（第三版修订 7）。
        const style = code.codeBlockStyle === "indented" || fence === undefined ? {indented: true} : {fence, closed: lines.length > 1 && closing.test(lines.at(-1) as string)};
        return [{type: "codeBlock", attrs: {language: code.lang || null, markdown: style}, content: code.text === "" ? [] : [text(code.text)]}];
    },
    hr: (token) => [{type: "horizontalRule", attrs: {markdown: token.raw.trim()}}],
    table: (token, context) => {
        const table = token as Tokens.Table;
        const cell = (type: string, value: Tokens.TableCell, align: string | null): JSONContent => ({type, attrs: {align}, content: [{type: "paragraph", content: context.inline(value.tokens)}]});
        return [{
            type: "table",
            content: [
                {type: "tableRow", content: table.header.map((value, index) => cell("tableHeader", value, table.align[index] ?? null))},
                ...table.rows.map((row) => ({type: "tableRow", content: row.map((value, index) => cell("tableCell", value, table.align[index] ?? null))})),
            ],
        }];
    },
    // 紧凑列表项里的文字（`marked` 在块层给 `text`）是一段。
    text: (token, context) => {
        const value = token as Tokens.Text;
        return [{type: "paragraph", content: value.tokens !== undefined && value.tokens.length > 0 ? context.inline(value.tokens) : readText(value.raw)}];
    },
};

export const coreExtensions: ReadonlyArray<AnyExtension> = [
    StarterKit.configure({
        paragraph: false,
        link: false,
        // 没有下划线（输出 26）：`++` 是普通文字，Ctrl+U 不起作用。
        underline: false,
        trailingNode: false,
        // 列表由 `@tiptap/extension-list` 的同名扩展提供（与任务列表同一个包）。
    }),
    MarkdownParagraph,
    TaskList,
    TaskItem.configure({nested: true}),
    TableKit.configure({tableCell: false, tableHeader: false}),
    SingleParagraphCell,
    SingleParagraphHeader,
    Image.configure({inline: true, allowBase64: false, HTMLAttributes: {class: "nb-markdown-image-node"}}),
    Link.configure({openOnClick: false, enableClickSelection: true, linkOnPaste: false}),
    MarkdownStyle,
];

export const coreSyntax: MarkdownSyntax = {
    name: "core",
    extensions: coreExtensions,
    marked: [markedCjkFriendly(), doubleTildeOnly, htmlInline],
    read: blockReaders,
    readInline: inlineReaders,
};
