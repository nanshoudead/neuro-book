/**
 * 编辑器里指向作品里文件的链接画成引用小块（docs/specs/workspace/markdown-dialect.md 输出 27；外观见 `../components/InlineChip.md`）：
 * 文字仍是链接本身，照常可编辑、写回不变，外框与图标是装饰。
 *
 * 一个链接按“同一个链接标记的连续范围”算：批注只盖住链接的一部分时，它在 DOM 里被拆成几段元素，范围仍是一个，外框只在两端
 * 收口（`chip.css` 的 `nb-chip-link`），图标只在开头一个。
 */

import {Extension} from "@tiptap/core";
import type {Mark, Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";

import {classifyTarget, showsAsChip} from "../../shared/targets";
import {chipView, renderChipIcon} from "../parts/chip";
import type {MarkdownViewHost} from "./view-host";

const KEY = new PluginKey<DecorationSet>("nb-reference-links");
/** 宿主信息变了（换文档）：重算装饰。 */
export const REFRESH_REFERENCE_LINKS = "nb-reference-links-refresh";

interface LinkRange {
    readonly from: number;
    readonly to: number;
    readonly mark: Mark;
}

/** 文档里每个链接的连续范围：相邻的文字与行内节点带着同一个链接标记（`eq`）就是同一个链接。 */
function linkRanges(doc: PMNode): LinkRange[] {
    const ranges: LinkRange[] = [];
    doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        let open: {from: number; to: number; mark: Mark} | null = null;
        node.forEach((child, offset) => {
            const start = pos + 1 + offset;
            const link = child.marks.find((mark) => mark.type.name === "link") ?? null;
            if (open !== null && link !== null && open.mark.eq(link) && open.to === start) {
                open.to = start + child.nodeSize;
                return;
            }
            if (open !== null) ranges.push(open);
            open = link === null ? null : {from: start, to: start + child.nodeSize, mark: link};
        });
        if (open !== null) ranges.push(open);
        return false;
    });
    return ranges;
}

function decorationsOf(doc: PMNode, host: MarkdownViewHost): DecorationSet {
    const decorations: Decoration[] = [];
    const base = host.base();
    for (const {from, to, mark} of linkRanges(doc)) {
        const href = String(mark.attrs.href ?? "");
        const target = classifyTarget(href, base);
        if (!showsAsChip(target.kind)) continue;
        const chip = chipView({kind: "reference", label: doc.textBetween(from, to), target: href, base, number: null, state: "ready", error: "", locale: host.locale()});
        decorations.push(Decoration.inline(from, to, {class: "nb-chip-link", title: chip.title, "data-reference-link": target.kind}));
        decorations.push(Decoration.inline(to - 1, to, {class: "nb-chip-link--end"}));
        decorations.push(Decoration.widget(from, (view) => {
            const document = view.dom.ownerDocument;
            const icon = document.createElement("span");
            icon.className = "nb-chip-link__icon";
            icon.contentEditable = "false";
            icon.append(renderChipIcon(document, chip.icon));
            return icon;
        }, {side: -1, key: `reference:${href}:${target.kind}`, ignoreSelection: true}));
    }
    return DecorationSet.create(doc, decorations);
}

export const MarkdownReferenceLinks = Extension.create<{host: MarkdownViewHost | null}>({
    name: "markdownReferenceLinks",
    addOptions() {
        return {host: null};
    },
    addProseMirrorPlugins() {
        const host = this.options.host;
        if (host === null) return [];
        return [new Plugin<DecorationSet>({
            key: KEY,
            state: {
                init: (_config, state) => decorationsOf(state.doc, host),
                apply: (tr, previous) => (tr.docChanged || tr.getMeta(REFRESH_REFERENCE_LINKS) === true ? decorationsOf(tr.doc, host) : previous),
            },
            props: {decorations: (state) => KEY.getState(state) ?? DecorationSet.empty},
        })];
    },
});
