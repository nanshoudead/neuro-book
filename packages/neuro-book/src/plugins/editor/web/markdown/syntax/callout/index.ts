/**
 * 提示块（docs/specs/workspace/markdown-dialect.md 输出 23）：引用的第一行是 `[!类型]`，后面可以跟折叠标记（`-`、`+`）与标题，
 * 其余是提示块的内容（与 GitHub、Obsidian 的写法相同）。`[!类型]` 不在第一行时是普通引用。
 *
 * 类型按原文的大小写记在 `type` 里，写回时不变；显示用的样式由界面按类型名（不分大小写）选。标题是原文，不按 Markdown 解释。
 * 折叠状态不写回：`fold` 只记原文里的折叠标记。新建的提示块写成 `> [!NOTE]`。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import type {NodeView} from "@tiptap/pm/view";
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
    addNodeView() {
        return ({node}) => calloutView(node);
    },
});

/** 有专门图标与颜色的五种类型（不分大小写）；其它类型按 `note` 显示。 */
const ICONS: Readonly<Record<string, string>> = {
    note: "i-lucide-info",
    tip: "i-lucide-lightbulb",
    important: "i-lucide-message-square-warning",
    warning: "i-lucide-triangle-alert",
    caution: "i-lucide-octagon-alert",
};

/**
 * 编辑器里的提示块：标题行（图标、标题或类型名、有折叠标记时的展开按钮）不可编辑，内容区是可编辑的子块。折叠状态只在这个
 * 视图里，不写回文件：带 `-` 的一开始折叠，`+` 的一开始展开，没有折叠标记的不能折叠。
 */
function calloutView(initial: PMNode): NodeView {
    let node = initial;
    let folded = node.attrs.fold === "-";
    const dom = document.createElement("div");
    const head = document.createElement("div");
    head.className = "nb-callout__title";
    head.contentEditable = "false";
    const icon = document.createElement("span");
    const label = document.createElement("span");
    label.className = "nb-callout__label";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nb-callout__toggle";
    const chevron = document.createElement("span");
    chevron.className = "i-lucide-chevron-right";
    toggle.append(chevron);
    // 整个标题行都能点（输出 23“点标题展开或折叠”）；按钮是键盘与读屏的入口，点它同样经过这里。
    head.addEventListener("click", (event) => {
        if (node.attrs.fold === null) return;
        event.preventDefault();
        folded = !folded;
        render();
    });
    const content = document.createElement("div");
    content.className = "nb-callout__content";
    head.append(icon, label, toggle);
    dom.append(head, content);
    const render = (): void => {
        const type = String(node.attrs.type ?? "NOTE");
        const kind = ICONS[type.toLowerCase()] === undefined ? "note" : type.toLowerCase();
        const foldable = node.attrs.fold !== null;
        dom.className = `nb-callout nb-callout--${kind}`;
        dom.dataset.callout = type;
        dom.dataset.calloutFolded = String(foldable && folded);
        icon.className = `nb-callout__icon ${ICONS[kind] as string}`;
        label.textContent = node.attrs.title === null || node.attrs.title === "" ? type : String(node.attrs.title);
        toggle.hidden = !foldable;
        toggle.setAttribute("aria-expanded", String(!(foldable && folded)));
        toggle.setAttribute("aria-label", label.textContent);
        content.hidden = foldable && folded;
    };
    render();
    return {
        dom,
        contentDOM: content,
        update: (next) => {
            if (next.type !== node.type) return false;
            node = next;
            render();
            return true;
        },
        // 标题行是界面，不是正文：点击与它的变化不交给编辑器。
        stopEvent: (event) => head.contains(event.target as globalThis.Node | null),
        ignoreMutation: (mutation) => !content.contains(mutation.target),
    };
}

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
