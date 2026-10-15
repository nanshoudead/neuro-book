/**
 * 时间线（docs/specs/story/queries.md 输出 12）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("timeline");
});

afterAll(async () => {
    await book.close();
});

describe("时间线（输出 12）", () => {
    test("按故事时间排；补叙的点标出写到它的那一章；日子未知的点不标补叙", async () => {
        const {points} = await book.ok("timeline", {at: {chapter: 100}});
        const flashbacks = points.filter(point => point.flashback !== null);
        expect(flashbacks.length).toBeGreaterThan(0);
        expect(flashbacks.every(point => point.day !== null && point.flashback === point.chapter)).toBe(true);
        const bySource = await book.ok("timeline", {at: {chapter: 100}, order: "source"});
        const chapters = bySource.points.map(point => point.chapter);
        expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    });
});
