/**
 * 提示块（docs/specs/workspace/markdown-dialect.md 输出 23）：引用的第一行是 `[!类型]`，后面可以跟折叠标记（`-`、`+`）与标题，
 * 其余是提示块的内容（与 GitHub、Obsidian 的写法相同）。`[!类型]` 不在第一行时是普通引用。
 *
 * 类型按原文的大小写记在 `type` 里，写回时不变；显示用的样式由界面按类型名（不分大小写）选。标题是原文，不按 Markdown 解释。
 * 折叠状态不写回：`fold` 只记原文里的折叠标记。新建的提示块写成 `> [!NOTE]`。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {Tokens} from "marked";

import {children} from "../core/write";
import type {BlockWriter, MarkdownSyntax, TokenReader} from "../types";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        callout: {
            setCallout: (type?: string) => ReturnType;
            unsetCallout: () => ReturnType;
        };
    }
}

export const Callout = Node.create({
    name: "callout",
    group: "block",
    content: "block+",
    defining: true,
    priority: 860,
    addAttributes() {
        return {type: {default: "NOTE"}, title: {default: null}, fold: {default: null}};
    },
    parseHTML() {
        return [{
            tag: "div[data-callout]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {type: element.getAttribute("data-callout") ?? "NOTE", title: element.getAttribute("data-callout-title"), fold: element.getAttribute("data-callout-fold")};
            },
        }];
    },
    renderHTML({node, HTMLAttributes}) {
        const type = String(node.attrs.type ?? "NOTE");
        return ["div", mergeAttributes(HTMLAttributes, {
            class: `nb-callout nb-callout--${type.toLowerCase()}`,
            "data-callout": type,
            ...(node.attrs.title === null ? {} : {"data-callout-title": String(node.attrs.title)}),
            ...(node.attrs.fold === null ? {} : {"data-callout-fold": String(node.attrs.fold)}),
        }), 0];
    },
    addCommands() {
        return {
            setCallout: (type = "NOTE") => ({commands}) => commands.wrapIn(this.name, {type}),
            unsetCallout: () => ({commands}) => commands.lift(this.name),
        };
    },
});

/** 第一行：`[!类型]`，可跟 `-` 或 `+`，再跟标题。 */
const HEAD = /^\[!([A-Za-z][\w-]*)\]([+-])?(?:[ \t]+(.*?))?[ \t]*$/u;

const read: Readonly<Record<string, TokenReader>> = {
    blockquote: (token, context) => {
        const text = (token as Tokens.Blockquote).text;
        const lineEnd = text.indexOf("\n");
        const head = HEAD.exec(lineEnd < 0 ? text : text.slice(0, lineEnd));
        if (head === null) return null;
        const content = lineEnd < 0 ? [] : context.blocks(context.lexBlocks(text.slice(lineEnd + 1)));
        return [{
            type: "callout",
            attrs: {type: head[1] as string, fold: head[2] ?? null, title: head[3] === undefined || head[3] === "" ? null : head[3]},
            content: content.length > 0 ? content : [{type: "paragraph"}],
        }];
    },
};

const writeBlock: Readonly<Record<string, BlockWriter>> = {
    callout: (node, context) => {
        const title = node.attrs.title === null || node.attrs.title === "" ? "" : ` ${String(node.attrs.title)}`;
        const head = `> [!${String(node.attrs.type ?? "NOTE")}]${String(node.attrs.fold ?? "")}${title}`;
        const body = children(node, context).join("\n\n");
        return body === "" ? head : `${head}\n${body.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n")}`;
    },
};

export const calloutSyntax: MarkdownSyntax = {
    name: "callout",
    extensions: [Callout],
    read,
    writeBlock,
};
