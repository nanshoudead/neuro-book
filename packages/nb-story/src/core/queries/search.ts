/**
 * 搜索：`search`（docs/specs/story/queries.md 输出 15）。只在可见的内容里搜，原文只搜到 P 为止；结果按对象、说法、
 * 原文三类依次排，各类内按出现先后。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import {visibleAt} from "../position";
import {firstRef, matches, type QueryContext} from "./context";

type Item = StoryResult<"search">["items"][number];

/** 原文命中时截取的前后字数。 */
const SNIPPET_RADIUS = 30;

function snippet(text: string, query: string): string {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function search(ctx: QueryContext, params: StoryParams<"search">): StoryResult<"search"> {
    const {view, grouping} = ctx;
    const query = params.query.trim();
    const kinds = new Set(params.kinds ?? ["entity", "statement", "source"]);
    const entities: (Item & {order: [number, number]})[] = [];
    const statements: Item[] = [];
    const source: Item[] = [];

    if (kinds.has("entity")) {
        for (const [node, label] of grouping.labels) {
            const names = (grouping.members.get(node) ?? []).flatMap(id => view.entity(id)!.names);
            const hit = matches(label, query) ? null : names.find(name => matches(name.text, query));
            if (!matches(label, query) && !hit) continue;
            const first = names.sort((a, b) => a.at.chapter - b.at.chapter || a.at.paragraph - b.at.paragraph)[0];
            const entity = view.entity(node)!;
            const at = first?.at ?? entity.at;
            entities.push({kind: "entity", id: node, text: hit ? `${label}（${hit.text}）` : label, ref: `${at.chapter}.${at.paragraph}`, order: [at.chapter, at.paragraph]});
        }
        entities.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || (a.id! < b.id! ? -1 : 1));
    }
    if (kinds.has("statement")) {
        for (const statement of view.statements) {
            if (matches(statement.text, query)) statements.push({kind: "statement", id: statement.id, text: statement.text, ref: firstRef(statement.source.evidence, statement.at)});
        }
    }
    if (kinds.has("source") && query !== "") {
        for (const chapter of view.chapters) {
            chapter.paragraphs.forEach((text, offset) => {
                const paragraph = offset + 1;
                if (visibleAt({chapter: chapter.chapter, paragraph}, view.at) && matches(text, query)) {
                    source.push({kind: "source", id: null, text: snippet(text, query), ref: `${chapter.chapter}.${paragraph}`});
                }
            });
        }
    }
    const page = ctx.page([...entities.map(({order: _order, ...item}) => item), ...statements, ...source]);
    return {...page, counts: {entity: entities.length, statement: statements.length, source: source.length}};
}
