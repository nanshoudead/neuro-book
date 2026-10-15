/**
 * 行内内容的写出（docs/specs/workspace/markdown-dialect.md 输出 2、4、5）：一个文本块里的文字、行内节点与标记。
 *
 * 标记的开闭：相邻两个节点的标记集合不同时，先关掉不再延续的（从里往外），再开新的。延续的标记排在前面、新开的按 schema 的
 * 优先级排，这样一个标记在它覆盖的那一段里只开一次，标签自然嵌套（两条重叠的批注在边界处拆成截）。
 *
 * 强调类标记（`emphasis`）两端的空白移到标记外面写：`** a**` 读不成粗体。写出前先对整段内容做 `../compare.ts` 的 `expel`，
 * 比较前也做同样的处理，两边按同一个规则。
 */

import type {Mark, Node as PMNode, Schema} from "@tiptap/pm/model";

import {expel, flatten, withoutStyles} from "../compare";
import type {InlineItem} from "../compare";

import type {InlinePlace, InlineWriter, MarkWriter, WriteContext} from "../../syntax/types";
import {Unrepresentable} from "../../syntax/types";
import {escapeText} from "./escape";

export interface InlineWriters {
    readonly inline: ReadonlyMap<string, InlineWriter>;
    readonly marks: ReadonlyMap<string, MarkWriter>;
    readonly markless: ReadonlySet<string>;
}

/**
 * 新建的标记没有写法属性：它紧挨着同类、其余属性相同的标记时跟随那个标记（方言 Spec 输出 2 的“跟随”），两段合成一段写，
 * 否则 `**说****了**` 读不回来。
 */
export function follow(items: InlineItem[]): void {
    const sameExceptStyle = (left: Mark, right: Mark): boolean => left.type === right.type && Object.keys(left.attrs).every((key) => key === "markdown" || left.attrs[key] === right.attrs[key]);
    for (const direction of [1, -1] as const) {
        const order = direction === 1 ? items.keys() : [...items.keys()].reverse();
        for (const index of order) {
            const item = items[index] as InlineItem;
            const neighbour = items[index - direction];
            if (neighbour === undefined) continue;
            item.marks = item.marks.map((mark) => {
                if (mark.attrs.markdown !== null && mark.attrs.markdown !== undefined) return mark;
                return neighbour.marks.find((other) => other !== mark && sameExceptStyle(mark, other) && other.attrs.markdown !== null) ?? mark;
            });
        }
    }
}

/**
 * 按强调与跟随规则整理过的行内内容：文字按标记重新分段，行内节点照旧。`markless` 的节点（硬换行）身上的标记去掉：行内代码里
 * 不能有换行，粗体跨着换行时去掉也只是在换行处关一次、再开一次。
 */
function normalized(parent: PMNode, emphasis: ReadonlySet<string>, markless: ReadonlySet<string>, canonical: boolean): PMNode[] {
    const items = flatten(parent, markless);
    if (canonical) withoutStyles(items);
    follow(items);
    expel(items, emphasis);
    const schema: Schema = parent.type.schema;
    const out: PMNode[] = [];
    let text = "";
    let marks: ReadonlyArray<Mark> | null = null;
    const push = (): void => {
        if (text !== "" && marks !== null) out.push(schema.text(text, marks as Mark[]));
        text = "";
        marks = null;
    };
    for (const item of items) {
        if (item.char === null) {
            push();
            out.push((item.node as PMNode).mark(item.marks as Mark[]));
            continue;
        }
        if (marks !== null && !(marks.length === item.marks.length && marks.every((mark) => mark.isInSet(item.marks)))) push();
        marks ??= item.marks;
        text += item.char;
    }
    push();
    return out;
}

/** 一个标记覆盖的那一段（从第一个带它的节点到最后一个）的纯文字。 */
function runText(children: ReadonlyArray<PMNode>, index: number, mark: Mark): string {
    let start = index;
    while (start > 0 && mark.isInSet((children[start - 1] as PMNode).marks)) start -= 1;
    let end = index;
    while (end < children.length - 1 && mark.isInSet((children[end + 1] as PMNode).marks)) end += 1;
    return children.slice(start, end + 1).map((child) => (child.isText ? (child.text as string) : "")).join("");
}

/** 这个节点要用的标记顺序：已经开着的、它也带的排前面（保持开着的先后），其余按 schema 的优先级。 */
function ordered(marks: ReadonlyArray<Mark>, active: ReadonlyArray<Mark>): Mark[] {
    const kept = active.filter((mark) => mark.isInSet(marks));
    const fresh = marks.filter((mark) => !mark.isInSet(kept)).sort((left, right) => (left.type as unknown as {rank: number}).rank - (right.type as unknown as {rank: number}).rank);
    return [...kept, ...fresh];
}

export function renderInline(parent: PMNode, context: WriteContext, place: InlinePlace, writers: InlineWriters): string {
    const emphasis = new Set([...writers.marks].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
    const children = normalized(parent, emphasis, writers.markless, context.options.styles === "canonical");
    const out: string[] = [];
    let active: Mark[] = [];
    const last = (): string => {
        for (let index = out.length - 1; index >= 0; index -= 1) {
            const piece = out[index] as string;
            if (piece !== "") return piece[piece.length - 1] as string;
        }
        return "";
    };
    const writerOf = (mark: Mark): MarkWriter => {
        const writer = writers.marks.get(mark.type.name);
        if (writer === undefined) throw new Unrepresentable(`没有 ${mark.type.name} 标记的写法`);
        return writer;
    };
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index] as PMNode;
        const previous = index === 0 ? null : (children[index - 1] as PMNode);
        const next = index === children.length - 1 ? null : (children[index + 1] as PMNode);
        const wanted = ordered(child.marks, active);
        let common = 0;
        while (common < active.length && common < wanted.length && (active[common] as Mark).eq(wanted[common] as Mark)) common += 1;
        for (let at = active.length - 1; at >= common; at -= 1) out.push(writerOf(active[at] as Mark).close(active[at] as Mark, context, {text: runText(children, index - 1, active[at] as Mark)}));
        const content = child.isText ? (child.text as string) : "";
        for (const mark of wanted.slice(common)) out.push(writerOf(mark).open(mark, context, {text: runText(children, index, mark)}));
        active = wanted;
        if (!child.isText) {
            const writer = writers.inline.get(child.type.name);
            if (writer === undefined) throw new Unrepresentable(`没有 ${child.type.name} 的写法`);
            out.push(writer(child, context, {previous, next, place}));
            continue;
        }
        if (active.some((mark) => writerOf(mark).verbatim?.(mark, context, {text: runText(children, index, mark)}) === true)) {
            // GFM 表格先按没转义的 `|` 切单元格，再解析行内内容：行内代码里的 `|` 也要转义。
            out.push(place.table === true ? content.replace(/\|/gu, "\\|") : content);
            continue;
        }
        const lineEnd = next === null || next.type.name === "hardBreak";
        const after = next === null ? "" : next.isText ? ((next.text as string)[0] as string) : next.type.name === "hardBreak" ? "\n" : "￼";
        out.push(escapeText(content, {lineStart: last() === "" || last() === "\n", lineEnd, before: last(), after, place, full: context.options.escape === "full", definitions: context.definitions}));
    }
    for (let at = active.length - 1; at >= 0; at -= 1) out.push(writerOf(active[at] as Mark).close(active[at] as Mark, context, {text: runText(children, children.length - 1, active[at] as Mark)}));
    return out.join("");
}
