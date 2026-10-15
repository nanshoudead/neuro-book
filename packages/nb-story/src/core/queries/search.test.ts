/**
 * 搜索（docs/specs/story/queries.md 输出 15）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("search");
});

afterAll(async () => {
    await book.close();
});

describe("搜索（输出 15）", () => {
    test("分对象、说法、原文三类；原文只搜到阅读位置为止", async () => {
        const result = await book.ok("search", {at: {chapter: 38, paragraph: 57}, query: "神典石", limit: 500});
        expect(result.counts.source).toBeGreaterThan(0);
        const kinds = result.items.map(item => item.kind);
        expect(kinds).toEqual([...kinds].sort((a, b) => ["entity", "statement", "source"].indexOf(a) - ["entity", "statement", "source"].indexOf(b)));
        for (const item of result.items.filter(entry => entry.kind === "source")) {
            const [chapter, paragraph] = item.ref.split(".").map(Number) as [number, number];
            expect(chapter < 38 || (chapter === 38 && paragraph <= 57)).toBe(true);
        }
        const later = await book.ok("search", {at: {chapter: 7}, query: "心月狐", limit: 500});
        expect(later.total).toBe(0);
    });
});
