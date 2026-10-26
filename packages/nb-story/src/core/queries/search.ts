/**
 * 搜索：`search`（docs/specs/story/queries.md 输出 15）。只在可见的内容里搜，原文只搜到 P 为止；结果按对象、说法、
 * 原文三类依次排。查询按空白与标点拆成几个词，含任一个词就算命中；各类内按含的不同词数从多到少，再按出现先后。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import {visibleAt} from "../position";
import {firstRef, matches, type QueryContext} from "./context";

type Item = StoryResult<"search">["items"][number];

/** 原文命中时截取的前后字数。 */
const SNIPPET_RADIUS = 30;

/** 查询里的词：按空白与标点拆开，去空、去重（不分大小写）。 */
export function searchTerms(query: string): string[] {
    const seen = new Set<string>();
    return query.split(/[\s\p{P}]+/u).filter(term => {
        const key = term.toLowerCase();
        if (term === "" || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 一段文字含几个不同的词。拆不出词的查询（空串、只有标点）沿用拆词之前的行为：对象与说法全部命中，原文不搜
 * （调用方另行跳过），所以这里对它们一律算命中 1 个。
 */
function hitCount(text: string, terms: readonly string[]): number {
    if (terms.length === 0) return 1;
    return terms.reduce((count, term) => count + (matches(text, term) ? 1 : 0), 0);
}

function snippet(text: string, terms: readonly string[]): string {
    const lower = text.toLowerCase();
    const first = Math.min(...terms.map(term => lower.indexOf(term.toLowerCase())).filter(index => index >= 0));
    const length = terms.find(term => lower.indexOf(term.toLowerCase()) === first)!.length;
    const start = Math.max(0, first - SNIPPET_RADIUS);
    const end = Math.min(text.length, first + length + SNIPPET_RADIUS);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** 按命中词数降序；词数相同的保持传入的先后（稳定排序）。 */
function byHits<T extends {hits: number}>(items: T[]): T[] {
    return items.toSorted((a, b) => b.hits - a.hits);
}

export function search(ctx: QueryContext, params: StoryParams<"search">): StoryResult<"search"> {
    const {view, grouping} = ctx;
    const terms = searchTerms(params.query.trim());
    const kinds = new Set(params.kinds ?? ["entity", "statement", "source"]);
    const entities: (Item & {order: [number, number]; hits: number})[] = [];
    const statements: (Item & {hits: number})[] = [];
    const source: (Item & {hits: number})[] = [];

    if (kinds.has("entity")) {
        for (const [node, label] of grouping.labels) {
            const names = (grouping.members.get(node) ?? []).flatMap(id => view.entity(id)!.names);
            // 显示名与各个称呼合起来算命中的词；显示名没有命中时，附上命中最多的那个称呼。
            const hits = hitCount([label, ...names.map(name => name.text)].join("\n"), terms);
            if (hits === 0) continue;
            const labelHits = hitCount(label, terms);
            const hit = labelHits > 0 ? null : names.toSorted((a, b) => hitCount(b.text, terms) - hitCount(a.text, terms))[0];
            const first = names.sort((a, b) => a.at.chapter - b.at.chapter || a.at.paragraph - b.at.paragraph)[0];
            const entity = view.entity(node)!;
            const at = first?.at ?? entity.at;
            entities.push({kind: "entity", id: node, text: hit ? `${label}（${hit.text}）` : label, ref: `${at.chapter}.${at.paragraph}`, order: [at.chapter, at.paragraph], hits});
        }
        entities.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || (a.id! < b.id! ? -1 : 1));
    }
    if (kinds.has("statement")) {
        for (const statement of view.statements) {
            const hits = hitCount(statement.text, terms);
            if (hits > 0) statements.push({kind: "statement", id: statement.id, text: statement.text, ref: firstRef(statement.source.evidence, statement.at), hits});
        }
    }
    if (kinds.has("source") && terms.length > 0) {
        for (const chapter of view.chapters) {
            chapter.paragraphs.forEach((text, offset) => {
                const paragraph = offset + 1;
                if (!visibleAt({chapter: chapter.chapter, paragraph}, view.at)) return;
                const hits = hitCount(text, terms);
                if (hits > 0) source.push({kind: "source", id: null, text: snippet(text, terms), ref: `${chapter.chapter}.${paragraph}`, hits});
            });
        }
    }
    const page = ctx.page([
        ...byHits(entities).map(({order: _order, hits: _hits, ...item}) => item),
        ...[...byHits(statements), ...byHits(source)].map(({hits: _hits, ...item}) => item),
    ]);
    return {...page, counts: {entity: entities.length, statement: statements.length, source: source.length}};
}
