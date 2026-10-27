/**
 * 记录等级的查询（docs/specs/story/queries.md 的“记录等级”）：人物卡说法的等级、`maxTier` 与各级条数、分页、
 * 视角不改等级、情节的先验、`tier.explain` 与 `record_not_found`。等级本身的规则在 core/tiers.test.ts。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";
import {sampleDataset} from "../../../testing/sample";

let book: TestBook;
/** 给几段情节写了先验的样例书。 */
let withPrior: TestBook;

beforeAll(async () => {
    book = await openTestBook("tiers");
    const dataset = await sampleDataset();
    withPrior = await openTestBook("tiers-prior", {...dataset, episodes: dataset.episodes.map(episode => (episode.id === "p1-1" ? {...episode, tier: 1} : episode))});
});

afterAll(async () => {
    await book.close();
    await withPrior.close();
});

const AT = {chapter: 50};

describe("人物卡的说法", () => {
    test("每条带等级；tiers 是各级条数；maxTier 只留不高于它的，顺序不变，tiers 不变", async () => {
        const all = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 500});
        expect(all.items.length).toBe(all.total);
        const counts = [1, 2, 3].map(tier => all.items.filter(item => item.tier === tier).length) as [number, number, number];
        expect(all.tiers).toEqual(counts);
        expect(counts.every(count => count > 0)).toBe(true);
        const folded = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 500, maxTier: 2});
        expect(folded.items.map(item => item.id)).toEqual(all.items.filter(item => item.tier <= 2).map(item => item.id));
        expect(folded.total).toBe(counts[0]! + counts[1]!);
        expect(folded.tiers).toEqual(all.tiers);
        // tiers 按 query 筛过之后数。
        const queried = await book.ok("entity.statements", {at: AT, entity: "e8-2", query: "神典石", limit: 500});
        expect(queried.tiers.reduce((a, b) => a + b, 0)).toBe(queried.total);
    });

    test("分页：带 maxTier 一页页取完等于一次取完；换了 maxTier 的游标失效", async () => {
        const whole = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 500, maxTier: 2});
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 7, maxTier: 2, ...(cursor ? {cursor} : {})});
            expect(page.tiers).toEqual(whole.tiers);
            ids.push(...page.items.map(item => item.id));
            cursor = page.next ?? undefined;
        } while (cursor !== undefined);
        expect(ids).toEqual(whole.items.map(item => item.id));
        const first = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 7, maxTier: 2});
        expect(await book.fail("entity.statements", {at: AT, entity: "e8-2", limit: 7, cursor: first.next})).toBe("cursor_invalid");
    });

    test("视角不改等级：读者与角色视角都能看到的说法，等级与标记相同", async () => {
        const reader = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 500});
        const character = await book.ok("entity.statements", {at: AT, entity: "e8-2", limit: 500, perspective: "e1-1"});
        const byId = new Map(reader.items.map(item => [item.id, item]));
        expect(character.items.length).toBeGreaterThan(5);
        for (const item of character.items) expect([item.tier, item.tierFlag]).toEqual([byId.get(item.id)!.tier, byId.get(item.id)!.tierFlag]);
    });
});

describe("情节的等级", () => {
    test("只有先验：写了的给出，没写的为 null", async () => {
        const list = await withPrior.ok("episodes.list", {at: {chapter: 1}, limit: 500});
        expect(list.items.find(item => item.id === "p1-1")!.tier).toBe(1);
        expect(list.items.filter(item => item.id !== "p1-1").every(item => item.tier === null)).toBe(true);
        const appearances = await withPrior.ok("entity.episodes", {at: {chapter: 1}, entity: "e1-1", limit: 500});
        expect(appearances.items.find(item => item.id === "p1-1")?.tier).toBe(1);
    });
});

describe("tier.explain", () => {
    test("说法：等级与列表一致，带先验、后验与后文信号", async () => {
        const all = await book.ok("entity.statements", {at: AT, entity: "e4-1", limit: 500});
        const confirmed = await book.ok("tier.explain", {at: AT, id: "s4-1"});
        expect(confirmed).toMatchObject({kind: "statement", tier: all.items.find(item => item.id === "s4-1")!.tier, prior: null, ev: "strong"});
        expect(confirmed.signals!.refs.confirms).toBeGreaterThan(0);
        // 结果是这次查询自己的：调用方改了它，同一位置再查不受影响。
        const confirms = confirmed.signals!.refs.confirms;
        confirmed.signals!.refs.confirms = 999;
        confirmed.signals!.echo.phrases.push("改过");
        const again = await book.ok("tier.explain", {at: AT, id: "s4-1"});
        expect(again.signals!.refs.confirms).toBe(confirms);
        expect(again.signals!.echo.phrases).not.toContain("改过");
    });

    test("情节：只有先验", async () => {
        expect(await withPrior.ok("tier.explain", {at: {chapter: 1}, id: "p1-1"})).toEqual({id: "p1-1", kind: "episode", tier: 1, prior: 1, flag: null, ev: null, window: null, signals: null});
    });

    test("位置之后的记录与不存在的记录都是 record_not_found", async () => {
        expect(await book.fail("tier.explain", {at: {chapter: 3}, id: "s4-1"})).toBe("record_not_found");
        expect(await book.fail("tier.explain", {at: AT, id: "没有这条"})).toBe("record_not_found");
    });
});
