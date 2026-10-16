/**
 * 双语对照（docs/specs/workspace/markdown-dialect.md 输出 13）：开标签 `<bilingual text="译文">` 独占一行、闭标签独占一行，
 * 中间是原文（一块或多块）。原文上方显示弱色的译文行。
 *
 * 写法属性 `markdown`：`{open, text}`，开标签的原文与它表示的译文；译文没变时按原文写回。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkedExtension} from "marked";

import {escapeAttribute} from "nbook/plugins/markdown/shared/markdown-dialect";

import {children} from "../core/write";
import {blockTagExtension} from "../tags";
import type {BlockTagToken} from "../tags";
import type {BlockWriter, MarkdownSyntax, TokenReader} from "../types";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownBilingual: {
            setMarkdownBilingual: (text: string) => ReturnType;
            updateMarkdownBilingual: (text: string) => ReturnType;
            unsetMarkdownBilingual: () => ReturnType;
        };
    }
}

export const MarkdownBilingual = Node.create({
    name: "markdownBilingual",
    group: "block",
    content: "block+",
    defining: true,
    priority: 880,
    addAttributes() {
        return {text: {default: ""}, markdown: {default: null, rendered: false, keepOnSplit: false}};
    },
    parseHTML() {
        return [{tag: "div[data-bilingual-text]", getAttrs: (dom) => ({text: (dom as HTMLElement).getAttribute("data-bilingual-text") ?? ""})}];
    },
    renderHTML({node, HTMLAttributes}) {
        return ["div", mergeAttributes(HTMLAttributes, {class: "nb-bilingual-block", "data-bilingual-text": String(node.attrs.text ?? "")}), 0];
    },
    addCommands() {
        return {
            setMarkdownBilingual: (text: string) => ({commands}) => commands.wrapIn(this.name, {text}),
            updateMarkdownBilingual: (text: string) => ({commands}) => commands.updateAttributes(this.name, {text}),
            unsetMarkdownBilingual: () => ({commands}) => commands.lift(this.name),
        };
    },
});

const accepts = (): boolean => true;
const tokenizer: MarkedExtension = {extensions: [blockTagExtension("markdownBilingual", "bilingual", accepts)]};

interface BilingualStyle {
    readonly open: string;
    readonly text: string;
}

const read: Readonly<Record<string, TokenReader>> = {
    markdownBilingual: (token, context) => {
        const value = token as unknown as BlockTagToken;
        const text = value.open.attributes.get("text") ?? "";
        return [{type: "markdownBilingual", attrs: {text, markdown: {open: value.open.raw, text} satisfies BilingualStyle}, content: context.blocks(value.tokens)}];
    },
};

const writeBlock: Readonly<Record<string, BlockWriter>> = {
    markdownBilingual: (node, context) => {
        const text = String(node.attrs.text ?? "");
        const style = context.style<BilingualStyle>(node);
        const open = style !== null && style.text === text ? style.open : `<bilingual text="${escapeAttribute(text)}">`;
        const body = children(node, context);
        return body.length === 0 ? `${open}\n</bilingual>` : `${open}\n${body.join("\n\n")}\n</bilingual>`;
    },
};

export const bilingualSyntax: MarkdownSyntax = {
    name: "bilingual",
    extensions: [MarkdownBilingual],
    marked: [tokenizer],
    read,
    writeBlock,
    blockOpens: {bilingual: accepts},
};
