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
});
