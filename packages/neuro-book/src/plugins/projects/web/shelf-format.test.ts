/** 书架的显示规则（shelf-format.ts）：字数与时间的写法、作品色档、排序、继续写作的选择、最近写到与合计。 */

import {describe, expect, it} from "bun:test";

import {testTextPort} from "nbook/shared/testing/text-port";

import {projectDisplayName} from "../shared/shelf";
import type {ShelfItem, ShelfStats} from "../shared/shelf";
import {autoBookColor, BOOK_PALETTE, bookColorStyle, bookPaletteIndex, continueTarget, formatToday, formatWhen, formatWords, lightColor, recentPieces, shelfTotals, sortShelf} from "./shelf-format";
import {projectsCatalogs} from "./text";

/** 按给定语言的翻译端口（与窗口同一个引擎，严格模式）。 */
const port = (locale: string) => testTextPort(locale, {"nbook.projects": projectsCatalogs});

function item(id: string, title: string | null, stats: Partial<ShelfStats> = {}): ShelfItem {
    return {
        id, name: id, title, description: null, color: null, cover: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "stale", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null, ...stats},
    };
}

const at = (iso: string) => ({address: "project://a.md", label: "a", at: iso, excerpt: ""});

describe("显示名", () => {
    it("有书名用书名；没有时用目录原名（中文目录的短名是 project，不显示它），两种路径分隔符与末尾的分隔符都认", () => {
        expect(projectDisplayName({title: "雾港纪事", path: "/home/me/NeuroBook/雾港"})).toBe("雾港纪事");
        expect(projectDisplayName({title: null, path: "/home/me/NeuroBook/雾港"})).toBe("雾港");
        expect(projectDisplayName({title: null, path: "C:\\Users\\me\\NeuroBook\\海与灯塔\\"})).toBe("海与灯塔");
    });
});

describe("字数", () => {
    it("中文一万以下写全数，一万以上写万字并留一位小数；英文以一千为界", () => {
        expect(formatWords(8240, port("zh-CN"))).toBe("8,240 字");
        expect(formatWords(10_000, port("zh-CN"))).toBe("1 万字");
        expect(formatWords(286_400, port("zh-CN"))).toBe("28.6 万字");
        expect(formatWords(840, port("en-US"))).toBe("840 words");
        expect(formatWords(21_500, port("en-US"))).toBe("21.5k words");
    });

    it("今天净增为负时带负号，不写成 0", () => {
        expect(formatToday(1240, port("zh-CN"))).toBe("今天 1,240 字");
        expect(formatToday(-320, port("zh-CN"))).toBe("今天 −320 字");
        expect(formatToday(0, port("en-US"))).toBe("0 today");
    });
});

describe("时间", () => {
    const now = "2026-10-10T16:30:00";
    it("今天与昨天带时分，今年只写月日，更早带年份", () => {
        expect(formatWhen("2026-10-10T09:05:00", now, port("zh-CN"))).toBe("今天 09:05");
        expect(formatWhen("2026-10-09T21:40:00", now, port("zh-CN"))).toBe("昨天 21:40");
        expect(formatWhen("2026-09-21T10:00:00", now, port("zh-CN"))).toBe("9月21日");
        expect(formatWhen("2025-12-30T23:30:00", now, port("zh-CN"))).toBe("2025年12月30日");
        expect(formatWhen("2026-10-09T21:40:00", now, port("en-US"))).toBe("Yesterday 21:40");
    });

    it("跨月的“昨天”按日历算", () => {
        expect(formatWhen("2026-09-30T23:00:00", "2026-10-01T08:00:00", port("zh-CN"))).toBe("昨天 23:00");
    });
});

describe("作品色", () => {
    it("自动色从色板八色里按 id 取，同一个 id 总是同一色；作者给了颜色就用它；作者给的浅色用深字", () => {
        for (const id of ["a", "b", "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"]) {
            expect(bookPaletteIndex(id)).toBeGreaterThanOrEqual(0);
            expect(bookPaletteIndex(id)).toBeLessThan(BOOK_PALETTE.length);
            expect(autoBookColor(id)).toBe(BOOK_PALETTE[bookPaletteIndex(id)]);
            expect(bookColorStyle({id, color: null})).toEqual({"--book-bg": autoBookColor(id)});
        }
        expect(bookColorStyle({id: "a", color: "#d9c9a3"})).toEqual({"--book-bg": "#d9c9a3"});
        expect(BOOK_PALETTE.every((color) => !lightColor(color))).toBe(true);
        expect(lightColor("#d9c9a3")).toBe(true);
        expect(lightColor("#7a4b3a")).toBe(false);
        expect(lightColor(null)).toBe(false);
    });
});

describe("最近写到与合计", () => {
    const books = [
        item("b", "北方", {words: 300, files: 2, today: 20, last: at("2026-10-08T10:00:00Z")}),
        item("a", "长夜", {words: 900, files: 5, today: null, last: at("2026-10-10T10:00:00Z")}),
        item("c", null, {words: 300, files: 1}),
        item("d", "雾中", {words: 100, files: 1, today: -5, last: at("2026-09-01T10:00:00Z")}),
    ];

    it("最近写到按时间从近到远取前几条，没有编辑记录的不算", () => {
        expect(recentPieces(books, 3).map((piece) => piece.item.id)).toEqual(["a", "b", "d"]);
        expect(recentPieces(books, 2).map((piece) => piece.item.id)).toEqual(["a", "b"]);
    });

    it("合计：字数与篇数全部相加，今天只加有数字的；都没有时为 null", () => {
        expect(shelfTotals(books)).toEqual({words: 1600, files: 9, books: 4, today: 15});
        expect(shelfTotals([item("c", null, {words: 1})])).toEqual({words: 1, files: 0, books: 1, today: null});
    });
});

describe("排序与继续写作", () => {
    const books = [
        item("b", "北方", {words: 300, last: at("2026-10-08T10:00:00Z")}),
        item("a", "长夜", {words: 900, last: at("2026-10-10T10:00:00Z")}),
        item("c", null, {words: 300}),
        item("d", "雾中", {words: 100, last: at("2026-09-01T10:00:00Z")}),
    ];

    it("最近编辑在前，没有编辑记录的排在最后", () => {
        expect(sortShelf(books, "recent", "zh-CN").map((book) => book.id)).toEqual(["a", "b", "d", "c"]);
    });

    it("字数多的在前，相同时按显示名（没有书名时用短名）", () => {
        expect(sortShelf(books, "words", "zh-CN").map((book) => book.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("按书名排序与输入顺序无关", () => {
        const forward = sortShelf(books, "title", "zh-CN").map((book) => book.id);
        expect(sortShelf([...books].reverse(), "title", "zh-CN").map((book) => book.id)).toEqual(forward);
    });

    it("继续写作选最近编辑的那一部；都没有编辑记录时没有", () => {
        expect(continueTarget(books)?.id).toBe("a");
        expect(continueTarget([item("x", "空")])).toBeNull();
    });
});
