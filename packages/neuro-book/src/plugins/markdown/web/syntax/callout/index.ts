/**
 * 提示块（docs/specs/workspace/markdown-dialect.md 输出 23）：引用的第一行是 `[!类型]`，后面可以跟折叠标记（`-`、`+`）与标题，
 * 其余是提示块的内容（与 GitHub、Obsidian 的写法相同）。`[!类型]` 不在第一行时是普通引用。
 *
 * 类型按原文的大小写记在 `type` 里，写回时不变；显示用的样式由界面按类型名（不分大小写）选。标题是原文，不按 Markdown 解释。
 * 折叠状态不写回：`fold` 只记原文里的折叠标记。新建的提示块写成 `> [!NOTE]`。
 */

import {mergeAttributes, Node} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
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
        return ({node, decorations, getPos, editor}) => calloutView(node, decorations, () => {
            const pos = typeof getPos === "function" ? getPos() : undefined;
            if (typeof pos === "number") editor.view.dispatch(editor.state.tr.setMeta(FOLDED, {toggle: pos}).setMeta("addToHistory", false));
        });
    },
    addProseMirrorPlugins() {
        return [foldPlugin];
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
 * 折叠的提示块（方言 Spec 输出 23）：按编辑状态记，不写回文件。每份文档建编辑状态时带 `-` 的折叠；点标题切换（只有带折叠
 * 标记的能折叠）。光标进到折叠的内容里、或这次改动碰到了折叠的提示块（例如在下一段段首退格并了进去），它就展开：看不见的
 * 内容不能被悄悄改掉。
 */
const FOLDED = new PluginKey<DecorationSet>("nb-callout-fold");

const folded = (doc: PMNode, pos: number): Decoration | null => {
    const node = doc.nodeAt(pos);
    return node?.type.name === "callout" && node.attrs.fold !== null ? Decoration.node(pos, pos + node.nodeSize, {}, {folded: true}) : null;
};

const foldPlugin = new Plugin<DecorationSet>({
    key: FOLDED,
    state: {
        init: (_config, state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
                if (node.type.name === "callout" && node.attrs.fold === "-") decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, {folded: true}));
                return true;
            });
            return DecorationSet.create(state.doc, decorations);
        },
        apply: (tr, set, oldState, newState) => {
            let next = set.map(tr.mapping, tr.doc);
            const toggle = (tr.getMeta(FOLDED) as {toggle?: number} | undefined)?.toggle;
            if (toggle !== undefined) {
                const existing = next.find(toggle, toggle + 1, (spec) => spec.folded === true).filter((decoration) => decoration.from === toggle);
                if (existing.length > 0) next = next.remove(existing);
                else {
                    const decoration = folded(newState.doc, toggle);
                    if (decoration !== null) next = next.add(newState.doc, [decoration]);
                }
                return next;
            }
            // 碰到了的（节点换了，或不再是可折叠的提示块）、光标进去了的展开。
            const {from, to} = newState.selection;
            const opened = next.find().filter((decoration) => {
                const node = newState.doc.nodeAt(decoration.from);
                if (node?.type.name !== "callout" || node.attrs.fold === null || decoration.to !== decoration.from + node.nodeSize) return true;
                const before = oldState.doc.nodeAt(tr.mapping.invert().map(decoration.from));
                if (tr.docChanged && before !== node) return true;
                return (from > decoration.from && from < decoration.to) || (to > decoration.from && to < decoration.to);
            });
            return opened.length > 0 ? next.remove(opened) : next;
        },
    },
    props: {
        decorations: (state) => FOLDED.getState(state),
    },
});

/**
 * 编辑器里的提示块：标题行（图标、标题或类型名、有折叠标记时的展开按钮）不可编辑，内容区是可编辑的子块。折叠与否来自
 * `foldPlugin` 给这个节点的装饰；点标题行请插件切换。
 */
function calloutView(initial: PMNode, initialDecorations: ReadonlyArray<Decoration>, toggleFold: () => void): NodeView {
    let node = initial;
    let decorations = initialDecorations;
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
        toggleFold();
    });
    const content = document.createElement("div");
    content.className = "nb-callout__content";
    head.append(icon, label, toggle);
    dom.append(head, content);
    const render = (): void => {
        const type = String(node.attrs.type ?? "NOTE");
        const kind = ICONS[type.toLowerCase()] === undefined ? "note" : type.toLowerCase();
        const foldable = node.attrs.fold !== null;
        const isFolded = foldable && decorations.some((decoration) => (decoration.spec as {folded?: boolean}).folded === true);
        dom.className = `nb-callout nb-callout--${kind}`;
        dom.dataset.callout = type;
        dom.dataset.calloutFolded = String(isFolded);
        icon.className = `nb-callout__icon ${ICONS[kind] as string}`;
        label.textContent = node.attrs.title === null || node.attrs.title === "" ? type : String(node.attrs.title);
        toggle.hidden = !foldable;
        toggle.setAttribute("aria-expanded", String(!isFolded));
        toggle.setAttribute("aria-label", label.textContent);
        content.hidden = isFolded;
    };
    render();
    return {
        dom,
        contentDOM: content,
        update: (next, nextDecorations) => {
            if (next.type !== node.type) return false;
            node = next;
            decorations = nextDecorations;
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
