/**
 * 增量整理的输入（docs/specs/story/ingest.md 输出 4）：只给这一段，五节各有上限。用样例书 100 章的最终草稿编到各章，
 * 整理稿取那时已有的（t34 的整批稿，最近一批就是快照）。
 */

import {describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {sampleDataset} from "../../testing/sample";
import type {Arc, Dataset} from "../core/dataset";
import {compile} from "./compile";
import {BUDGETS, CANDIDATE_LIMIT, consolidationContext, LOOKBACK, SUMMARIZED_LIMIT} from "./consolidation-context";
import {mergeRefusal} from "./draft-tools";

const FINAL = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest", "run-med-100-final.json.gz");

/** 编到第 `chapter` 章：原文与草稿到这一章，整理稿到 `since`（不含这一章自己这次）。 */
async function datasetAt(chapter: number, since: number): Promise<Dataset> {
    const sample = await sampleDataset();
    const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: {through: number}[]};
    return compile(sample.book, sample.sources.filter(item => item.chapter <= chapter), final.drafts.slice(0, chapter), final.consolidations.filter(item => item.through <= since)).dataset;
}

/** 按二级标题切出各节，去掉标题与说明行后数字数（与上限的算法相同：每行加一个换行）。 */
function sections(text: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const part of text.split(/\n(?=## )/u).slice(1)) {
        const [title, ...rest] = part.split("\n");
        map.set(title!.slice(3), rest.filter(line => line !== ""));
    }
    return map;
}
const size = (lines: string[]) => lines.reduce((sum, line) => sum + line.length + 1, 0);

describe("增量整理的输入", () => {
    test("第 20、50、100 章：只给这一段，各节不超上限，对象、候选与清理的范围一致", async () => {
        for (const chapter of [20, 50, 100]) {
            const dataset = await datasetAt(chapter, chapter - 5);
            const {text, scope} = consolidationContext(dataset, chapter, chapter - 5);
            const parts = sections(text);
            expect({chapter, segment: text.includes(`“这一段”是第 ${chapter - 4} 到 ${chapter} 章。`)}).toEqual({chapter, segment: true});
            expect([...parts.keys()].slice(0, 4)).toEqual(["当前的主线", "这一段的情节", "这一段的对象", "这一段的记录"]);

            // 快照就是查询看到的最近一批。
            const latest = Math.max(...dataset.arcs.map(arc => arc.through));
            expect({chapter, base: scope.base, arcs: scope.arcs.map(arc => arc.id)}).toEqual({chapter, base: latest, arcs: dataset.arcs.filter(arc => arc.through === latest).map(arc => arc.id)});

            // 情节只有这一段的；记录只有这一段的，知情只有手写的。
            const episodeIds = (parts.get("这一段的情节") ?? []).map(line => /^(p\d+-\d+)/u.exec(line)?.[1]).filter(Boolean);
            expect(episodeIds).toEqual(dataset.episodes.filter(item => item.at.chapter > chapter - 5).map(item => item.id));
            const recordIds = (parts.get("这一段的记录") ?? []).map(line => /^([skl]\S*?)　/u.exec(line)?.[1]).filter((id): id is string => id !== undefined);
            expect(recordIds.length).toBeGreaterThan(0);
            for (const id of recordIds) expect({id, handwritten: /^[skl]\d+-\d+$/u.test(id), inSegment: Number(/^[skl](\d+)-/u.exec(id)?.[1]) > chapter - 5}).toEqual({id, handwritten: true, inSegment: true});
            expect(size(recordIds.length ? parts.get("这一段的记录")!.filter(line => /^[skl]\S*?　/u.test(line)) : [])).toBeLessThanOrEqual(BUDGETS.records);

            // 列了现有归纳的对象就是清理时允许改写已有方面的那些，最多 15 个。
            expect(scope.summarized.size).toBeLessThanOrEqual(SUMMARIZED_LIMIT);
            const objectLines = parts.get("这一段的对象")!;
            const others = objectLines.findIndex(line => line.startsWith("其余的对象"));
            const listedWithSummaries = (others === -1 ? objectLines : objectLines.slice(0, others)).filter(line => /^e\d+-\d+｜/u.test(line)).map(line => line.split("｜")[0]);
            expect(new Set(listedWithSummaries)).toEqual(new Set(scope.summarized));

            // 合并候选：都满足清理的合并条件，至少一方是这一段新建或新增了称呼的。
            expect(scope.candidates.length).toBeLessThanOrEqual(CANDIDATE_LIMIT);
            const entities = new Map(dataset.entities.map(entity => [entity.id, entity]));
            const fresh = (id: string) => entities.get(id)!.at.chapter > chapter - 5 || entities.get(id)!.names.some(name => name.at.chapter > chapter - 5);
            for (const [a, b] of scope.candidates) expect({a, b, refusal: mergeRefusal(entities.get(a)!, entities.get(b)!, dataset), fresh: fresh(a) || fresh(b)}).toEqual({a, b, refusal: null, fresh: true});

            // 请求有固定上限：五节上限之和加标题与说明。
            expect(text.length).toBeLessThan(BUDGETS.arcs + BUDGETS.episodes + BUDGETS.summaries + BUDGETS.others + BUDGETS.records + 5000);
        }
    }, 60_000);

    test(`上一次整理在很久以前：只回看 ${LOOKBACK} 章`, async () => {
        const dataset = await datasetAt(100, 60);
        const {text} = consolidationContext(dataset, 100, 60);
        expect(text).toContain(`“这一段”是第 ${100 - LOOKBACK + 1} 到 100 章。`);
        const episodeIds = (sections(text).get("这一段的情节") ?? []).map(line => /^(p\d+-\d+)/u.exec(line)?.[1]).filter(Boolean);
        expect(episodeIds.every(id => Number(/^p(\d+)-/u.exec(id!)?.[1]) > 100 - LOOKBACK)).toBe(true);
    }, 30_000);

    test("主线多到超出上限：先不列已结束的，注明没列的条数；清理仍认得全部主线", async () => {
        const dataset = structuredClone(await datasetAt(50, 45));
        const latest = Math.max(...dataset.arcs.map(arc => arc.through));
        const template = dataset.arcs.find(arc => arc.through === latest)!;
        const extra: Arc[] = Array.from({length: 120}, (_, index) => ({...template, id: `a${latest}-${100 + index}`, title: `已结束的主线${index}`.padEnd(60, "。"), status: "closed"}));
        dataset.arcs.push(...extra);
        const {text, scope} = consolidationContext(dataset, 50, 45);
        const lines = sections(text).get("当前的主线")!.filter(line => /^a\d+-\d+｜/u.test(line));
        expect(size(lines)).toBeLessThanOrEqual(BUDGETS.arcs);
        expect(lines.filter(line => line.includes("｜进行中｜")).length).toBe(dataset.arcs.filter(arc => arc.through === latest && arc.status === "ongoing").length);
        const total = dataset.arcs.filter(arc => arc.through === latest).length;
        expect(text).toContain(`（另有 ${total - lines.length} 条较早的主线没有列出，它们照样留下。）`);
        expect(scope.arcs.length).toBe(total);
    }, 30_000);

    test("书关掉数值与秘密：记录里没有状态变动、没有指向秘密的知情", async () => {
        const dataset = await datasetAt(100, 95);
        const off = {...dataset, book: {...dataset.book, features: {ledger: false, secrets: false}}};
        const on = sections(consolidationContext(dataset, 100, 95).text).get("这一段的记录")!;
        const records = sections(consolidationContext(off, 100, 95).text).get("这一段的记录")!;
        expect(on.some(line => /^l\d+-\d+　/u.test(line))).toBe(true);
        expect(records.some(line => /^l\d+-\d+　/u.test(line))).toBe(false);
        const secretTargets = new Set(dataset.knowledge.filter(item => item.about.startsWith("x")).map(item => item.id));
        expect(records.some(line => secretTargets.has(line.split("　")[0]!))).toBe(false);
    }, 30_000);
});

describe("各节超出上限", () => {
    test("情节太多：只列最近的，注明没列的段数；清理只收列出的那些", async () => {
        const dataset = structuredClone(await datasetAt(50, 45));
        const template = dataset.episodes.find(item => item.at.chapter === 50)!;
        const extra = Array.from({length: 80}, (_, index) => ({...template, id: `p50-${100 + index}`, summary: `${template.summary}`.padEnd(200, "。"), at: {chapter: 50, paragraph: template.at.paragraph}}));
        dataset.episodes.push(...extra);
        const {text, scope} = consolidationContext(dataset, 50, 45);
        const lines = sections(text).get("这一段的情节")!.filter(line => /^p\d+-\d+（/u.test(line));
        expect(size(lines)).toBeLessThanOrEqual(BUDGETS.episodes);
        const segment = dataset.episodes.filter(item => item.at.chapter > 45);
        expect(lines.map(line => line.split("（")[0])).toEqual(segment.slice(segment.length - lines.length).map(item => item.id));
        expect(text).toContain(`（只列最近的 ${lines.length} 段，更早的 ${segment.length - lines.length} 段没有列出。）`);
        expect([...scope.episodes]).toEqual(lines.map(line => line.split("（")[0]));
    }, 30_000);

    test("归纳太长：少列几个对象的归纳，它们归入“其余”；其余也太多时截断并注明", async () => {
        const dataset = structuredClone(await datasetAt(50, 45));
        // 每个相关对象都有一段很长的概览，15 个放不下；再加 200 个这一段新建的对象，“其余”放不下。
        const long = "很长的一句归纳。".repeat(120);
        const relevant = consolidationContext(dataset, 50, 45).scope.summarized;
        for (const entity of relevant) dataset.summaries.push({entity, facet: "overview", through: 45, items: [{text: long, deps: ["p1-1"]}], at: {chapter: 45, paragraph: 1}});
        const template = dataset.entities.find(entity => entity.at.chapter <= 45)!;
        for (let index = 0; index < 200; index++) dataset.entities.push({...template, id: `e50-${100 + index}`, label: `这一段新出现的路人${index}`.padEnd(30, "。"), names: [], mergedFrom: [], at: {chapter: 50, paragraph: 1}});
        const {text, scope} = consolidationContext(dataset, 50, 45);
        const objects = sections(text).get("这一段的对象")!;
        const others = objects.findIndex(line => line.startsWith("其余的对象"));
        const summaryPart = objects.slice(2, others);
        const otherLines = objects.slice(others + 2).filter(line => /^e\d+-\d+｜/u.test(line));
        expect(size(summaryPart)).toBeLessThanOrEqual(BUDGETS.summaries);
        expect(scope.summarized.size).toBeLessThan(relevant.size);
        expect(size(otherLines)).toBeLessThanOrEqual(BUDGETS.others);
        expect(objects.at(-1)).toMatch(/^（另有 \d+ 个没有列出。）$/u);
        for (const id of relevant) if (!scope.summarized.has(id)) expect(summaryPart.some(line => line.startsWith(`${id}｜`))).toBe(false);
    }, 30_000);
});

describe("相关对象", () => {
    test("知情指向秘密时算上秘密涉及的对象，状态变动算上得到的那件东西", async () => {
        const dataset = structuredClone(await datasetAt(50, 45));
        const before = consolidationContext(dataset, 50, 45).text;
        // 找两个这一段完全没涉及的对象：一个当秘密的对象，一个当得到的东西。
        const quiet = dataset.entities.filter(entity => !before.includes(`${entity.id}｜`)).map(entity => entity.id);
        const [secretAbout, gained] = [quiet[0]!, quiet[1]!];
        dataset.secrets.push({...dataset.secrets[0]!, id: "x50-99", about: [secretAbout], statements: [], at: {chapter: 50, paragraph: 1}});
        dataset.knowledge.push({...dataset.knowledge.find(item => /^k\d+-\d+$/u.test(item.id))!, id: "k50-99", who: "e1-1", about: "x50-99", derived: false, at: {chapter: 50, paragraph: 1}});
        dataset.ledger.push({...dataset.ledger[0]!, id: "l50-99", owner: "e1-1", op: "get", item: gained, at: {chapter: 50, paragraph: 1}});
        const text = consolidationContext(dataset, 50, 45).text;
        expect(text).toContain(`${secretAbout}｜`);
        expect(text).toContain(`${gained}｜`);
    }, 30_000);
});
