/**
 * 情节、主线与本章变化（docs/specs/story/queries.md 输出 13、验收 6）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("episodes");
});

afterAll(async () => {
    await book.close();
});

describe("情节与主线（输出 13、验收 6）", () => {
    test("第 38 章只给归纳到第 35 章的那一批；第 1 章第一段情节只属于其中一条主线", async () => {
        const arcs = await book.ok("arcs.list", {at: {chapter: 38}});
        expect(arcs.through).toBe(35);
        expect(arcs.arcs.filter(arc => arc.episodes.includes("p1-1"))).toHaveLength(1);
        const episodes = await book.ok("episodes.list", {at: {chapter: 38}, limit: 500});
        expect(episodes.items.find(item => item.id === "p1-1")!.arcs).toHaveLength(1);
    });

    test("这一批里没有的情节 arcs 为空（未归入主线）；按主线筛只给它的情节", async () => {
        const episodes = await book.ok("episodes.list", {at: {chapter: 38}, limit: 500});
        expect(episodes.items.some(item => item.arcs.length === 0)).toBe(true);
        const arc = (await book.ok("arcs.list", {at: {chapter: 38}})).arcs[0]!;
        const filtered = await book.ok("episodes.list", {at: {chapter: 38}, arc: arc.id, limit: 500});
        expect(filtered.items.map(item => item.id).sort()).toEqual([...arc.episodes].sort());
    });

    test("本章变化：揭晓的秘密、新提出与有进展的悬念；阅读位置之后的章报 beyond_position", async () => {
        const digest = await book.ok("chapter.digest", {at: {chapter: 38}, chapter: 37});
        expect(digest.revealedSecrets.map(item => item.id)).toContain("x30-1");
        expect(await book.fail("chapter.digest", {at: {chapter: 38}, chapter: 39})).toBe("beyond_position");
    });

    test("参与者带出场身份，另有地点、故事时间与连接说明（输出 13）", async () => {
        const {items} = await book.ok("episodes.list", {at: {chapter: 38}, limit: 500});
        const p41 = items.find(item => item.id === "p4-1")!;
        expect(p41.who).toContainEqual({id: "e4-1", label: "南小风", as: "风信子"});
        expect(p41.place?.label).toBe("蓉城市绿心公园");
        expect(p41.time).toEqual({id: expect.any(String), label: "风信子赶往绿心公园并与怪人交战"});
        const p22 = items.find(item => item.id === "p2-2")!;
        expect(p22.links[0]!.note).toBe("发生在苏天晴答应与墨丘利秘典签约之后");
    });

    test("还没认出化名的视角里，以化名出场的参与者只算化名，不暴露真身（输出 1、13）", async () => {
        // p37-1、p37-2 里南嘉鱼以地狱猫出场。第 38 章读者已经知道二者是同一人，情节里写成“南嘉鱼（以化名）”；
        // 苏天晴还不知道，她视角的关系图里这两段算苏天晴与地狱猫同场（共 6 段），不算在南嘉鱼头上（只按真身算是 4 段）。
        const reader = await book.ok("episodes.list", {at: {chapter: 38}, query: "补充魔力的方法"});
        expect(reader.items.find(item => item.id === "p37-1")!.who).toContainEqual({id: "e8-2", label: "南嘉鱼", as: expect.any(String)});
        const tq = await book.ok("graph.relations", {at: {chapter: 38}, perspective: "e1-1", minTogether: 1});
        const edge = tq.edges.find(item => [item.a, item.b].sort().join("|") === "e1-1|e33-1")!;
        expect(edge.together).toBe(6);
    });
});
