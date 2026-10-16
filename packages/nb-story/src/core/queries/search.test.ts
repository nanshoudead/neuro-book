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

    test("一个词：对象在前，说法按出现先后", async () => {
        const result = await book.ok("search", {at: {chapter: 38}, query: "南嘉鱼", limit: 3});
        expect(result.counts).toEqual({entity: 1, statement: 102, source: 174});
        expect(result.items.map(item => [item.kind, item.ref])).toEqual([
            ["entity", "8.74"],
            ["statement", "9.7—9.10"],
            ["statement", "9.14—9.17"],
        ]);
    });

    test("几个词：含任一个就命中，含的词多的排在前面", async () => {
        const result = await book.ok("search", {at: {chapter: 38}, query: "南嘉鱼 地狱猫", kinds: ["statement"], limit: 2});
        // 只含“南嘉鱼”的 102 条加上只含“地狱猫”的，两个都含的 37.8 排第一。
        expect(result.total).toBe(124);
        expect(result.items[0]).toMatchObject({ref: "37.8", text: "地狱猫就是南嘉鱼暗中活动的反派魔法少女身份。"});
        expect(result.items[1]!.ref).toBe("9.7—9.10");
    });

    test("标点也拆词；原文片段截在命中的词周围", async () => {
        const spaced = await book.ok("search", {at: {chapter: 38}, query: "南嘉鱼 地狱猫", kinds: ["statement"], limit: 500});
        const punctuated = await book.ok("search", {at: {chapter: 38}, query: "南嘉鱼，地狱猫", kinds: ["statement"], limit: 500});
        expect(punctuated.items).toEqual(spaced.items);
        const source = await book.ok("search", {at: {chapter: 38}, query: "神典石 1300", kinds: ["source"], limit: 1});
        expect(source.items[0]).toMatchObject({ref: "38.36"});
        expect(source.items[0]!.text).toContain("1300");
    });

    test("翻页：第二页接着给后面的条目", async () => {
        const first = await book.ok("search", {at: {chapter: 38}, query: "神典石", kinds: ["source"], limit: 3});
        expect(first.items.map(item => item.ref)).toEqual(["2.84", "3.27", "4.49"]);
        const second = await book.ok("search", {at: {chapter: 38}, query: "神典石", kinds: ["source"], limit: 3, cursor: first.next!});
        expect(second.items.map(item => item.ref)).toEqual(["4.50", "5.35", "5.39"]);
    });
});
