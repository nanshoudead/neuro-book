/**
 * 书级查询共用的上下文与小工具。每次调用由 api.ts 建一份：固定的一代、阅读位置的视图、视角的分组与分页。
 */

import type {NodeRef, StoryMethod, Tags} from "../../contract/contract";
import type {BookIndex} from "../book-index";
import {paginate} from "../cursor";
import type {Basis, Position, Span, StatementKind} from "../dataset";
import type {Grouping} from "../identity";
import {formatSpan} from "../position";
import type {BookView} from "../projection";

export interface QueryContext {
    readonly method: StoryMethod;
    readonly index: BookIndex;
    readonly view: BookView;
    /** 这次调用的视角分组；不适用视角的方法拿到读者视角。 */
    readonly grouping: Grouping;
    /** 按调用参数里的 cursor、limit 取一页。 */
    page<T>(items: readonly T[]): {items: T[]; total: number; next: string | null};
    /** 把调用参数里的对象（id、名字或称呼）解析成读者视角下的点 id；见 api.ts 的 resolveEntity。 */
    resolveEntity(text: string): string;
}

export function makePager(generation: string, digest: string, cursor: string | undefined, limit: number | undefined): QueryContext["page"] {
    return items => paginate(items, {generation, digest, cursor, limit});
}

export function refs(spans: readonly Span[]): string[] {
    return spans.map(formatSpan);
}

/** 记录的第一个出处；没有出处时退回它成立的那一段。 */
export function firstRef(spans: readonly Span[], at: Position): string {
    return spans[0] ? formatSpan(spans[0]) : `${at.chapter}.${at.paragraph}`;
}

export function tags(kind: StatementKind | null, basis: Basis): Tags {
    return {kind, inferred: basis === "inferred"};
}

/** 对象在这个分组下所在的点；对象不可见时为 null。 */
export function nodeRef(grouping: Grouping, entityId: string): NodeRef | null {
    const node = grouping.nodeOf.get(entityId);
    return node === undefined ? null : {id: node, label: grouping.labels.get(node)!};
}

/** 一组对象各自所在的点，去重、保持先后。 */
export function nodeRefs(grouping: Grouping, entityIds: Iterable<string>): NodeRef[] {
    const seen = new Set<string>();
    const result: NodeRef[] = [];
    for (const id of entityIds) {
        const ref = nodeRef(grouping, id);
        if (ref && !seen.has(ref.id)) {
            seen.add(ref.id);
            result.push(ref);
        }
    }
    return result;
}

/** 搜索用的“包含这段文字”：忽略大小写与首尾空白。 */
export function matches(text: string, query: string | undefined): boolean {
    if (query === undefined || query.trim() === "") return true;
    return text.toLowerCase().includes(query.trim().toLowerCase());
}

export function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
