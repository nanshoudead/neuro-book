/**
 * 对齐（docs/specs/workspace/markdown-dialect.md 输出 14）：开标签 `<align value="…">` 独占一行、闭标签独占一行，中间的块按
 * `value` 对齐。`value` 只能是 `left`、`center`、`right`、`justify`，否则这里不认领（整体为原样块）。`left` 照原样保留。
 * 开闭标签写在同一行的 `<align value="center">文本</align>` 也能读，等于只含一段的块，写回时保持这种写法（内容还是一行时）。
 *
 * 写法属性 `markdown`：`{open, value, inline}`，开标签的原文与它表示的对齐；对齐没变时按原文写回。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkedExtension} from "marked";

import {escapeAttribute} from "nbook/shared/markdown-dialect";

import {children} from "../core/write";
import {blockTagExtension} from "../tags";
import type {BlockTagToken} from "../tags";
import type {BlockWriter, MarkdownSyntax, TokenReader} from "../types";

export type AlignValue = "left" | "center" | "right" | "justify";
const VALUES = new Set<string>(["left", "center", "right", "justify"]);

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownAlign: {
            setMarkdownAlign: (align: AlignValue) => ReturnType;
        };
    }
}

export const MarkdownAlign = Node.create({
    name: "markdownAlign",
    group: "block",
    content: "block+",
    defining: true,
    priority: 900,
    addAttributes() {
        return {align: {default: "left"}, markdown: {default: null, rendered: false, keepOnSplit: false}};
    },
    parseHTML() {
        return [{tag: "align[value]", getAttrs: (dom) => ({align: (dom as HTMLElement).getAttribute("value") ?? "left"})}];
    },
    renderHTML({HTMLAttributes}) {
        return ["align", mergeAttributes({value: HTMLAttributes.align, style: `text-align: ${String(HTMLAttributes.align)}`}), 0];
    },
    addCommands() {
        return {
            // 取消对齐（`left`）时去掉标签（输出 14）。
            setMarkdownAlign: (align: AlignValue) => ({commands, editor}) => {
                if (align === "left") return editor.isActive(this.name) ? commands.lift(this.name) : true;
                if (editor.isActive(this.name)) return commands.updateAttributes(this.name, {align});
                return commands.wrapIn(this.name, {align});
            },
        };
    },
});

const accepts = (attributes: ReadonlyMap<string, string>): boolean => VALUES.has(attributes.get("value") ?? "");

const tokenizer: MarkedExtension = {extensions: [blockTagExtension("markdownAlign", "align", accepts, true)]};

interface AlignStyle {
    readonly open: string;
    readonly value: string;
    readonly inline: boolean;
}

const read: Readonly<Record<string, TokenReader>> = {
    markdownAlign: (token, context) => {
        const value = token as unknown as BlockTagToken;
        const align = value.open.attributes.get("value") as string;
        return [{type: "markdownAlign", attrs: {align, markdown: {open: value.open.raw, value: align, inline: value.inline} satisfies AlignStyle}, content: context.blocks(value.tokens)}];
    },
};

const writeBlock: Readonly<Record<string, BlockWriter>> = {
    markdownAlign: (node, context) => {
        const align = String(node.attrs.align ?? "left");
        const style = context.style<AlignStyle>(node);
        const open = style !== null && style.value === align ? style.open : `<align value="${escapeAttribute(align)}">`;
        const body = children(node, context);
        if (style?.inline === true && body.length === 1 && node.childCount === 1 && node.child(0).type.name === "paragraph" && !(body[0] as string).includes("\n")) return `${open}${body[0] as string}</align>`;
        return body.length === 0 ? `${open}\n</align>` : `${open}\n${body.join("\n\n")}\n</align>`;
    },
};

export const alignSyntax: MarkdownSyntax = {
    name: "align",
    extensions: [MarkdownAlign],
    marked: [tokenizer],
    read,
    writeBlock,
    blockTags: ["align"],
    openTagAtLineEnd: `align\\s(?:[^>\\n]*\\s)?value\\s*=\\s*["']?(?:left|center|right|justify)["']?[^>\\n]*`,
};
