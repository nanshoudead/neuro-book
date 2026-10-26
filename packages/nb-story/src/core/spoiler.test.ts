/**
 * 不剧透（全量）：docs/specs/story/queries.md 输出 1、验收 1。经公开的 api 在几个阅读位置调全部只读方法。
 *
 * 递归核对结果里每个出处与记录 id 的成立位置只是辅助：提前合并、偷用后文的计数、未来章的标题都不会多出未来的
 * id。所以另按项断言：合并只用已成立的确定身份连接、称呼只用可见的、计数等于按可见记录重算的条数、主线是最近
 * 一批、目录里之后的章没有标题。期望值都直接从原始数据按 Spec 的规则算，不经被测代码。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import type {StoryMethod} from "../contract/contract";
import {openTestBook, type TestBook} from "../../testing/api";
import {sampleDataset} from "../../testing/sample";
import type {Dataset, Position} from "./dataset";

let book: TestBook;
let dataset: Dataset;
/** 原始数据里每条记录 id 的成立位置。 */
const idAt = new Map<string, Position>();

beforeAll(async () => {
    book = await openTestBook("spoiler");
    dataset = await sampleDataset();
    for (const key of ["entities", "statements", "secrets", "knowledge", "episodes", "questions", "times", "beats", "ledger", "arcs"] as const) {
        for (const record of dataset[key]) idAt.set(record.id, record.at);
    }
});

afterAll(async () => {
    await book.close();
});

const POSITIONS: {label: string; at: {chapter: number; paragraph?: number}; resolved: () => Position}[] = [
    {label: "1", at: {chapter: 1}, resolved: () => ({chapter: 1, paragraph: dataset.sources[0]!.paragraphs.length})},
    {label: "8", at: {chapter: 8}, resolved: () => ({chapter: 8, paragraph: dataset.sources[7]!.paragraphs.length})},
    {label: "38", at: {chapter: 38}, resolved: () => ({chapter: 38, paragraph: dataset.sources[37]!.paragraphs.length})},
    {label: "38.57", at: {chapter: 38, paragraph: 57}, resolved: () => ({chapter: 38, paragraph: 57})},
    // 这两处有记录的出处终点晚于它自己的 at（情节步骤、悬念进展），用来核对成立位置取的是出处终点。
    {label: "16.29", at: {chapter: 16, paragraph: 29}, resolved: () => ({chapter: 16, paragraph: 29})},
    {label: "33.87", at: {chapter: 33, paragraph: 87}, resolved: () => ({chapter: 33, paragraph: 87})},
    {label: "100", at: {chapter: 100}, resolved: () => dataset.through},
];

const notAfter = (at: Position, p: Position) => at.chapter < p.chapter || (at.chapter === p.chapter && at.paragraph <= p.paragraph);
/** 记录的成立位置：自身 at 与全部出处终点里最晚的那个（book-index.ts 的模块头）。 */
const settled = (at: Position, spans: readonly {chapter: number; to: number}[]): Position =>
    spans.reduce<Position>((latest, span) => (notAfter({chapter: span.chapter, paragraph: span.to}, latest) ? latest : {chapter: span.chapter, paragraph: span.to}), at);
const REF = /^(\d+)\.(\d+)(?:—(\d+)\.(\d+))?$/u;

/** 递归找出结果里成立位置晚于 P 的出处与记录 id。 */
function leaks(value: unknown, p: Position, path: string, found: string[]): void {
    if (typeof value === "string") {
        const at = idAt.get(value);
        if (at && !notAfter(at, p)) found.push(`${path}: ${value}`);
        const ref = REF.exec(value);
        if (ref) {
            const end = ref[3] ? {chapter: Number(ref[3]), paragraph: Number(ref[4])} : {chapter: Number(ref[1]), paragraph: Number(ref[2])};
            if (!notAfter(end, p)) found.push(`${path}: ${value}`);
        }
    } else if (Array.isArray(value)) {
        value.forEach((item, index) => leaks(item, p, `${path}[${index}]`, found));
    } else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) leaks(item, p, `${path}.${key}`, found);
    }
}

/** 按 Spec 规则从原始数据算读者视角下由几个对象合成的点。 */
function expectedGroups(p: Position): string[][] {
    const visible = new Set(dataset.entities.filter(entity => notAfter(entity.at, p)).map(entity => entity.id));
    const parent = new Map<string, string>();
    const find = (id: string): string => (parent.get(id) === undefined || parent.get(id) === id ? id : find(parent.get(id)!));
    for (const s of dataset.statements) {
        const [a, b] = s.about;
        if (s.family !== "identity" || s.neg || s.about.length !== 2 || a === b || s.certainty !== "certain" || s.kind === "claim") continue;
        if (!notAfter(s.at, p) || !visible.has(a!) || !visible.has(b!)) continue;
        const [ra, rb] = [find(a!), find(b!)];
        if (ra !== rb) parent.set(rb, ra);
    }
    const groups = new Map<string, string[]>();
    for (const id of visible) {
        const root = find(id);
        groups.set(root, [...(groups.get(root) ?? []), id]);
    }
    return [...groups.values()].filter(group => group.length > 1).map(group => group.sort()).sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
}

describe.each(POSITIONS)("阅读位置 $label", ({at, resolved}) => {
    test("全部只读方法的结果里没有阅读位置之后的出处与记录", async () => {
        const p = resolved();
        const calls: [StoryMethod, Record<string, unknown>][] = [
            ["book.info", {}],
            ["book.stats", {}],
            ["entities.list", {limit: 500}],
            ["entity.card", {entity: "e1-1"}],
            ["entity.knowledge", {entity: "e1-1", limit: 500}],
            ["entity.statements", {entity: "e1-1", limit: 500}],
            ["entity.episodes", {entity: "e1-1", limit: 500}],
            ["entity.relations", {entity: "e1-1"}],
            ["entity.relation", {entity: "e1-1", other: "e1-2"}],
            ["secrets.matrix", {}],
            ["ledger.tracks", {}],
            ["questions.list", {limit: 500}],
            ["timeline", {}],
            ["episodes.list", {limit: 500}],
            ["arcs.list", {}],
            ["source.read", {from: {chapter: p.chapter, paragraph: 1}, to: {chapter: p.chapter, paragraph: Math.min(p.paragraph, 200)}}],
            ["search", {query: "魔法少女", limit: 500}],
            ["search", {query: "苏天晴", limit: 500}],
            ["graph.relations", {}],
            ["graph.relations", {kinds: ["person", "persona", "group", "item", "place", "concept", "task", "other"]}],
            ["graph.book", {grain: "arc", types: ["entity", "arc", "secret", "question"]}],
            ["graph.book", {grain: "episode", types: ["entity", "episode", "secret", "question"]}],
            ["graph.storyline", {}],
            ["chapter.digest", {chapter: p.chapter}],
        ];
        const found: string[] = [];
        for (const [method, params] of calls) {
            const outcome = await book.api.call(method, {...params, at});
            if (!outcome.ok) throw new Error(`${method} 失败：${outcome.error.code} ${outcome.error.message}`);
            const value = outcome.value as Record<string, unknown>;
            // 全书元数据按 Spec 本来就覆盖全书。
            if (method === "book.info") delete value.extractedThrough;
            leaks(value, p, method, found);
        }
        for (let paragraph = 1; paragraph <= Math.min(p.paragraph, 40); paragraph += 1) {
            const records = await book.ok("source.records", {at, chapter: p.chapter, paragraph});
            leaks(records, p, `source.records ${p.chapter}.${paragraph}`, found);
        }
        expect(found).toEqual([]);
    });

    test("合并只用已成立的确定身份连接；称呼只用可见的", async () => {
        const p = resolved();
        const roster = await book.ok("entities.list", {at, limit: 500});
        const merged = roster.items.filter(item => item.entities.length > 1).map(item => [...item.entities].sort()).sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
        expect(merged).toEqual(expectedGroups(p));
        const visibleNames = new Map<string, Set<string>>();
        for (const entity of dataset.entities) visibleNames.set(entity.id, new Set(entity.names.filter(name => notAfter(name.at, p)).map(name => name.text)));
        for (const item of roster.items) {
            const allowed = new Set(item.entities.flatMap(id => [...visibleNames.get(id)!]));
            for (const name of item.names.top) expect(allowed.has(name)).toBe(true);
        }
    });

    test("计数只按可见的记录算；主线是最近一批；目录里之后的章没有标题", async () => {
        const p = resolved();
        const stats = await book.ok("book.stats", {at});
        expect(stats.visible.statements).toBe(dataset.statements.filter(s => notAfter(settled(s.at, s.source.evidence), p)).length);
        expect(stats.visible.episodes).toBe(dataset.episodes.filter(e => notAfter(settled(e.at, [...e.evidence, ...e.steps.map(step => step.evidence)]), p)).length);
        const card = await book.ok("entity.card", {at, entity: "e1-1"});
        const members = new Set(card.entities);
        const visibleTargets = new Set([
            ...dataset.statements.filter(r => notAfter(settled(r.at, r.source.evidence), p)).map(r => r.id),
            ...dataset.secrets.filter(r => notAfter(r.at, p)).map(r => r.id),
        ]);
        expect(card.counts.knowledge).toBe(dataset.knowledge.filter(k => members.has(k.who) && notAfter(settled(k.at, k.evidence), p) && visibleTargets.has(k.about)).length);
        const arcs = await book.ok("arcs.list", {at});
        const throughs = dataset.arcs.filter(arc => notAfter(arc.at, p)).map(arc => arc.through);
        expect(arcs.through).toBe(throughs.length > 0 ? Math.max(...throughs) : null);
        const info = await book.ok("book.info", {at});
        for (const item of info.toc) expect(item.title === null).toBe(item.chapter > p.chapter);
    });
});
