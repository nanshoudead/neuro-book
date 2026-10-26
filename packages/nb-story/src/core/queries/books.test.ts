/**
 * 书的统计（docs/specs/story/queries.md 输出 2）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("books");
});

afterAll(async () => {
    await book.close();
});

describe("统计（输出 2）", () => {
    test("逐章计数只到阅读位置所在章，合计等于可见条数", async () => {
        const stats = await book.ok("book.stats", {at: {chapter: 38, paragraph: 57}});
        expect(stats.chapters.map(row => row.chapter)).toEqual(Array.from({length: 38}, (_, index) => index + 1));
        const sum = (key: "statements" | "knowledge" | "episodes" | "ledger" | "raised") => stats.chapters.reduce((total, row) => total + row[key], 0);
        expect(sum("statements")).toBe(stats.visible.statements!);
        expect(sum("knowledge")).toBe(stats.visible.knowledge!);
        expect(sum("episodes")).toBe(stats.visible.episodes!);
        expect(sum("ledger")).toBe(stats.visible.ledger!);
        expect(sum("raised")).toBe(stats.visible.questions!);
    });

    test("主要人物逐章出场：至多 12 人，每人的计数到阅读位置所在章为止，第一位是苏天晴", async () => {
        const stats = await book.ok("book.stats", {at: {chapter: 38}});
        expect(stats.cast.length).toBeLessThanOrEqual(12);
        expect(stats.cast[0]!.label).toBe("苏天晴");
        expect(stats.cast.every(person => person.counts.length === 38)).toBe(true);
        const at7 = await book.ok("book.stats", {at: {chapter: 7}});
        // 第 7 章苏天晴与狐狐已经合并，心月狐的出场算在她头上；第 8 章及以后没有数。
        expect(at7.cast[0]!.counts).toHaveLength(7);
        expect(at7.cast.map(person => person.label)).not.toContain("心月狐");
    });
});
