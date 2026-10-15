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

describe("时间线的故事先后（输出 12）", () => {
    test("日子已知的点按第几天、时段排，不倒退；日子不明的排在最后", async () => {
        const PARTS = ["dawn", "morning", "forenoon", "noon", "afternoon", "dusk", "evening", "night"];
        for (const chapter of [64, 100]) {
            const {points} = await book.ok("timeline", {at: {chapter}});
            const known = points.filter(point => point.day !== null);
            for (let index = 1; index < known.length; index += 1) {
                const [a, b] = [known[index - 1]!, known[index]!];
                const order = a.day! - b.day! || (a.part === null ? -1 : PARTS.indexOf(a.part)) - (b.part === null ? -1 : PARTS.indexOf(b.part));
                expect(order, `${a.id} 在 ${b.id} 前`).toBeLessThanOrEqual(0);
            }
            const firstUnknown = points.findIndex(point => point.day === null);
            if (firstUnknown >= 0) expect(points.slice(firstUnknown).every(point => point.day === null)).toBe(true);
        }
    });
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
