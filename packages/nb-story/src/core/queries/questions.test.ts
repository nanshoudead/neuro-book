/**
 * 悬念（docs/specs/story/queries.md 输出 11）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("questions");
});

afterAll(async () => {
    await book.close();
});

describe("悬念（输出 11）", () => {
    test("状态取最新进展；只在提出那一章提到、没有进展的是琐碎悬念", async () => {
        const all = await book.ok("questions.list", {at: {chapter: 38}, limit: 500});
        const q82 = all.items.find(item => item.id === "q8-2")!;
        expect(q82.state).toBe("partial");
        expect(q82.updates.every(update => update.chapter <= 38)).toBe(true);
        expect(all.items.some(item => item.trivial)).toBe(true);
        expect(all.items.filter(item => item.trivial).every(item => item.state === "open")).toBe(true);
    });

    test("按状态筛；默认最近有进展的在前，可改成按提出顺序", async () => {
        const open = await book.ok("questions.list", {at: {chapter: 38}, state: "open", limit: 500});
        expect(open.items.every(item => item.state === "open")).toBe(true);
        const raised = await book.ok("questions.list", {at: {chapter: 38}, sort: "raised", limit: 500});
        const chapters = raised.items.map(item => item.raised.chapter);
        expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    });

    test("相关情节：出处与提出或进展重叠的可见情节，按章排序（输出 11）", async () => {
        const all = await book.ok("questions.list", {at: {chapter: 38}, limit: 500});
        const withEpisodes = all.items.filter(item => item.episodes.length > 0);
        expect(withEpisodes.length).toBeGreaterThan(all.items.length / 2);
        for (const item of withEpisodes) {
            const chapters = item.episodes.map(episode => episode.chapter);
            expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
            expect(chapters.every(chapter => chapter <= 38)).toBe(true);
        }
    });
});
