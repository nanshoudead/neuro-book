/**
 * 名册、人物卡与人物卡的长列表（docs/specs/story/queries.md 输出 6、7、8）与秘密矩阵（输出 9、验收 4）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("entities");
});

afterAll(async () => {
    await book.close();
});

describe("名册（输出 6）", () => {
    test("按出场次数从多到少；可按类别筛、按称呼搜", async () => {
        const roster = await book.ok("entities.list", {at: {chapter: 38}, limit: 500});
        const mentions = roster.items.map(item => item.mentions);
        expect(mentions).toEqual([...mentions].sort((a, b) => b - a));
        expect(roster.total).toBe(roster.items.length);
        const people = await book.ok("entities.list", {at: {chapter: 38}, kind: "group", limit: 500});
        expect(people.items.length).toBeGreaterThan(0);
        expect(people.items.every(item => item.kind === "group")).toBe(true);
        const found = await book.ok("entities.list", {at: {chapter: 38}, query: "小狐狸"});
        expect(found.items.map(item => item.id)).toContain("e1-1");
    });

    test("称呼只列前 6 个并给出总数", async () => {
        const roster = await book.ok("entities.list", {at: {chapter: 100}, limit: 1});
        expect(roster.items[0]!.names.top.length).toBeLessThanOrEqual(6);
        expect(roster.items[0]!.names.total).toBeGreaterThan(6);
    });
});

describe("人物卡（输出 7）", () => {
    test("名字可以写称呼；给出可见称呼与首次出现、读者知道的同一身份、各方面概况与条数", async () => {
        const card = await book.ok("entity.card", {at: {chapter: 38}, entity: "狐狐"});
        expect(card.id).toBe("e1-1");
        expect(card.names.find(name => name.text === "心月狐")!.ref).toMatch(/^8\.\d+$/u);
        expect(card.identities.map(item => item.id)).toContain("e6-2");
        expect(card.facets.map(item => item.facet)).toContain("overview");
        expect(card.counts.knowledge).toBeGreaterThan(0);
    });

    test("知道的秘密每个秘密一格，没有记录的写“没有记录”", async () => {
        const card = await book.ok("entity.card", {at: {chapter: 38}, entity: "e12-5"});
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 38}});
        expect(card.secrets.map(item => item.id).sort()).toEqual(matrix.rows.map(row => row.id).sort());
        expect(card.secrets.some(item => item.state === "no-record" && item.ref === null)).toBe(true);
    });

    test("还没出现的对象报 entity_not_found；称呼对应几个对象报 entity_ambiguous 并列出候选", async () => {
        expect(await book.fail("entity.card", {at: {chapter: 7}, entity: "心月狐"})).toBe("entity_not_found");
        expect(await book.fail("entity.card", {at: {chapter: 7}, entity: "e33-1"})).toBe("entity_not_found");
        const outcome = await book.api.call("entity.card", {at: {chapter: 38}, entity: "小破书"});
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.error.code).toBe("entity_ambiguous");
            expect(outcome.error.candidates!.map(item => item.id).sort()).toEqual(["e1-1", "e1-2"]);
        }
    });
});

describe("人物卡的长列表（输出 7、8）", () => {
    test("知情记录分页取得到全部条数，与人物卡上的条数一致；带记录标记", async () => {
        const at = {chapter: 100};
        const card = await book.ok("entity.card", {at, entity: "e1-1"});
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await book.ok("entity.knowledge", {at, entity: "e1-1", limit: 200, ...(cursor ? {cursor} : {})});
            expect(page.total).toBe(card.counts.knowledge);
            seen.push(...page.items.map(item => item.id));
            cursor = page.next ?? undefined;
        } while (cursor);
        expect(new Set(seen).size).toBe(card.counts.knowledge);
    });

    test("推断出的记录照常返回并标明推断；角色的说法标 claim", async () => {
        const statements = await book.ok("entity.statements", {at: {chapter: 100}, entity: "e1-1", limit: 500});
        expect(statements.items.some(item => item.tags.kind === "claim")).toBe(true);
        const knowledge = await book.ok("entity.knowledge", {at: {chapter: 100}, entity: "e1-1", limit: 500});
        expect(knowledge.items.some(item => item.tags.inferred)).toBe(true);
    });

    test("按状态筛、按字搜", async () => {
        const unaware = await book.ok("entity.knowledge", {at: {chapter: 100}, entity: "e1-1", state: "unaware", limit: 500});
        expect(unaware.items.every(item => item.state === "unaware")).toBe(true);
        const episodes = await book.ok("entity.episodes", {at: {chapter: 38}, entity: "e1-1", query: "风信子", limit: 500});
        expect(episodes.items.length).toBeGreaterThan(0);
        expect(episodes.items.every(item => item.chapter <= 38)).toBe(true);
    });
});

describe("秘密矩阵（输出 9、验收 4）", () => {
    test("第 38 章“深蓝猫娘是南嘉鱼的反派身份”一行的读者格是知道，出处是 37.8，不是第 30 章的怀疑", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 38}});
        const row = matrix.rows.find(item => item.id === "x30-1")!;
        const reader = row.cells.find(cell => cell.column === "reader")!;
        expect(reader).toEqual({column: "reader", state: "knows", ref: "37.8"});
        expect(row.revealedAt).toBe("37.8");
    });

    test("37.7 时读者还只是怀疑", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 37, paragraph: 7}});
        const reader = matrix.rows.find(item => item.id === "x30-1")!.cells.find(cell => cell.column === "reader")!;
        expect(reader.state).toBe("suspects");
        expect(reader.ref).toMatch(/^30\./u);
    });

    test("人物各行取这个人最新的状态；没有记录的格给“没有记录”", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 38}});
        const cells = matrix.rows.flatMap(row => row.cells.filter(cell => cell.column !== "reader"));
        expect(cells.some(cell => cell.state === "no-record" && cell.ref === null)).toBe(true);
        const tq = matrix.rows.find(row => row.id === "x30-1")!.cells.find(cell => cell.column === "e1-1")!;
        expect(tq.state).toBe("unaware");
    });

    test("第 7 章时没有第 8 章及以后才有的秘密", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 7}});
        expect(matrix.rows.map(row => row.id).sort()).toEqual(["x21-1", "x4-1", "x6-1"]);
    });
});
