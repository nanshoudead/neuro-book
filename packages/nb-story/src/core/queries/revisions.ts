/**
 * 图的修订的读方法：`revisions.list`、`revisions.evidence`，以及 `book.info` 里的待确认计数
 * （docs/specs/story/revisions.md 输出 7、15、16）。写入方法在 `overlay/ops.ts`。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import type {BookIndex} from "../book-index";
import type {Position} from "../dataset";
import {listItems} from "../overlay/items";
import type {ItemList} from "../overlay/items";
import {formatPosition} from "../position";
import type {QueryContext} from "./context";

/** 同一份索引、同一个阅读位置的列表只算一次：`book.info` 每次打开书都要计数，列表页再取一次明细。 */
const cache = new WeakMap<BookIndex, Map<string, ItemList>>();

export function revisionItems(index: BookIndex, at: Position): ItemList {
    let byPosition = cache.get(index);
    if (!byPosition) cache.set(index, (byPosition = new Map()));
    const key = formatPosition(at);
    let list = byPosition.get(key);
    if (!list) byPosition.set(key, (list = listItems(index.overlay.original, index.overlay.file, index.overlay.resolved, at)));
    return list;
}

export function revisionCounts(index: BookIndex, at: Position): {pending: number; stale: number} {
    const {counts} = revisionItems(index, at);
    return {pending: counts.pending, stale: counts.stale};
}

export function revisionsList(ctx: QueryContext, params: StoryParams<"revisions.list">): StoryResult<"revisions.list"> {
    const {items, counts} = revisionItems(ctx.index, ctx.view.at);
    // 给了 entity：只留涉及这个对象（读者视角下合成一个点的各个对象都算）的项，给人物卡用；counts 仍是全书的。
    const members = params.entity === undefined ? null : new Set(ctx.grouping.members.get(ctx.resolveEntity(params.entity)) ?? []);
    const rows = items.filter(item => (params.state === undefined || item.state === params.state) && (params.source === undefined || item.source === params.source) && (members === null || item.entities.some(id => members.has(id))));
    return {...ctx.page(rows), counts};
}

/** 对象在阅读位置之前出现的段落，按位置从近到远；`text` 限定只要含这个称呼的段。 */
export function revisionsEvidence(ctx: QueryContext, params: StoryParams<"revisions.evidence">): StoryResult<"revisions.evidence"> {
    const node = ctx.resolveEntity(params.entity);
    const members = new Set(ctx.grouping.members.get(node) ?? [node]);
    const byParagraph = new Map<string, {chapter: number; paragraph: number; names: Set<string>}>();
    for (const mention of ctx.view.mentions) {
        if (!members.has(mention.entity) || (params.text !== undefined && mention.text !== params.text)) continue;
        const key = `${mention.at.chapter}.${mention.at.paragraph}`;
        const entry = byParagraph.get(key) ?? {chapter: mention.at.chapter, paragraph: mention.at.paragraph, names: new Set<string>()};
        entry.names.add(mention.text);
        byParagraph.set(key, entry);
    }
    const rows = [...byParagraph.values()]
        .sort((a, b) => b.chapter - a.chapter || b.paragraph - a.paragraph)
        .map(entry => ({ref: `${entry.chapter}.${entry.paragraph}`, text: ctx.index.chapters.get(entry.chapter)?.paragraphs[entry.paragraph - 1] ?? "", names: [...entry.names]}));
    return ctx.page(rows);
}
