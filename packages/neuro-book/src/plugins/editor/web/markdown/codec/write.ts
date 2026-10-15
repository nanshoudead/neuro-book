/**
 * 写回（docs/specs/workspace/markdown-dialect.md 输出 1、2）：编辑器的文档 → 原文。没被编辑的块写它的原文字节，块与块之间的间隔
 * 两侧都没变时写原来的间隔，其余按空段落数重新生成。被编辑的块交给 `render`（写出器）重新写出。
 *
 * 判断“没被编辑”靠节点对象：ProseMirror 的编辑只替换改动处的节点，其余顶层子节点还是读入时的同一个对象。
 */

import type {Node as PMNode} from "@tiptap/pm/model";

import type {Origin, ReadResult, SourceUnit} from "./read";
import {emptiesTrailing} from "./read";

/** 写出一组需要重新写出的顶层节点；写不出返回 null。 */
export type BlockRenderer = (nodes: ReadonlyArray<PMNode>) => string | null;

export type WriteResult =
    | {readonly ok: true; readonly text: string}
    | {readonly ok: false; readonly code: "unrepresentable"; readonly from: number; readonly to: number};

/** 写回时的一项：一块原文（同一块的节点都还在、按原顺序相邻）或一个要重新写出的节点，连同它前面的空段落数。 */
interface Item {
    readonly nodes: ReadonlyArray<PMNode>;
    readonly unit: SourceUnit | null;
    readonly emptiesBefore: number;
    /** 第一个节点在文档里的位置（写不出时报告用）。 */
    readonly from: number;
    readonly to: number;
}

/** 顶层的空段落是间隔在编辑器里的样子（方言 Spec 的“块”）。 */
const isEmptyParagraph = (node: PMNode): boolean => node.type.name === "paragraph" && node.childCount === 0;

function itemsOf(doc: PMNode, origins: WeakMap<PMNode, Origin>): {items: Item[]; trailingEmpties: number} {
    const children: Array<{node: PMNode; pos: number}> = [];
    doc.forEach((node, pos) => children.push({node, pos}));
    const items: Item[] = [];
    let empties = 0;
    for (let index = 0; index < children.length; index += 1) {
        const {node, pos} = children[index] as {node: PMNode; pos: number};
        if (isEmptyParagraph(node)) {
            empties += 1;
            continue;
        }
        const origin = origins.get(node);
        // 一块读出几个节点时，要它们都还在、按原顺序紧挨着，才写这一块的原文。
        if (origin !== undefined && origin.part === 0) {
            const run = children.slice(index, index + origin.unit.size);
            const intact = run.length === origin.unit.size && run.every((child, part) => {
                const other = origins.get(child.node);
                return other !== undefined && other.unit === origin.unit && other.part === part;
            });
            if (intact) {
                const last = run.at(-1) as {node: PMNode; pos: number};
                items.push({nodes: run.map((child) => child.node), unit: origin.unit, emptiesBefore: empties, from: pos, to: last.pos + last.node.nodeSize});
                index += origin.unit.size - 1;
                empties = 0;
                continue;
            }
        }
        items.push({nodes: [node], unit: null, emptiesBefore: empties, from: pos, to: pos + node.nodeSize});
        empties = 0;
    }
    return {items, trailingEmpties: empties};
}

/**
 * 写回整篇。`render` 写出需要重新写出的节点（一次一个顶层节点）。
 */
export function writeMarkdown(doc: PMNode, base: ReadResult, render: BlockRenderer): WriteResult {
    const {items, trailingEmpties} = itemsOf(doc, base.origins);
    const eol = base.eol;
    // 整篇没有内容：打开时就是这样且没动过（只有那一个占位空段落）写原文，否则写空正文。
    if (items.length === 0) {
        const untouched = doc.childCount === 1 && base.doc.childCount === 1 && base.origins.get(base.doc.child(0)) === undefined && isEmptyParagraph(base.doc.child(0));
        return {ok: true, text: base.prefix + (untouched ? base.body : "")};
    }
    const parts: string[] = [base.prefix];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index] as Item;
        const previous = index === 0 ? null : (items[index - 1] as Item);
        const unit = item.unit;
        // 间隔：两侧都是原来的块、在那一代原文里相邻、中间的空段落数没变，才写原来的间隔。
        const keep = unit !== null && unit.emptiesBefore === item.emptiesBefore && (previous === null ? unit.prev === null : previous.unit !== null && previous.unit.next === unit);
        if (keep) parts.push(unit.gapBefore);
        else parts.push(eol.repeat(previous === null ? item.emptiesBefore : item.emptiesBefore + 2));
        if (unit !== null) {
            parts.push(unit.raw);
            continue;
        }
        const rendered = render(item.nodes);
        if (rendered === null) return {ok: false, code: "unrepresentable", from: item.from, to: item.to};
        parts.push(rendered);
    }
    const last = items.at(-1) as Item;
    const trailing = base.trailing;
    if (last.unit !== null && last.unit.next === null && emptiesTrailing(trailing) === trailingEmpties) parts.push(trailing);
    else parts.push(eol.repeat(trailingEmpties + (trailing.includes("\n") || base.body.endsWith("\n") ? 1 : 0)));
    return {ok: true, text: parts.join("")};
}
