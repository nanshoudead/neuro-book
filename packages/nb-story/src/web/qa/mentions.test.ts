/**
 * 输入框的 `@` 引用（docs/specs/story/viewer.md 输出 49）：两组候选、晚于阅读位置的不能选、插进去的写法，以及按查询取人物。
 */

import {describe, expect, test} from "bun:test";

import {createMentionSearch, mentionMenu, mentionPlainText, type MentionBook, type MentionEntity} from "./mentions";

const BOOK: MentionBook = {
    paragraphs: [10, 12, 8],
    toc: [
        {chapter: 1, title: "雨夜"},
        {chapter: 2, title: "旧钟与雨"},
        {chapter: 3, title: null},
    ],
};
const SU: MentionEntity = {id: "e7", label: "苏天晴", kind: "person", names: ["苏天晴", "晴", "苏老师", "天晴"]};
const BELL: MentionEntity = {id: "e9", label: "旧钟", kind: "item", names: ["旧钟"]};

const shown = (menu: ReturnType<typeof mentionMenu>) => menu.items.map(item => [item.group, item.label, item.description, item.disabled ?? false, item.insertText]);

describe("@ 菜单", () => {
    test("人物与对象在前、章节与段落在后；插进去的是带 id 的引用", () => {
        const menu = mentionMenu("", {entities: [SU, BELL], book: BOOK, at: {chapter: 2, paragraph: 5}});
        expect(menu.loading).toBeUndefined();
        expect(shown(menu)).toEqual([
            ["人物与对象", "苏天晴", "人物 · 也叫 晴、苏老师", false, "[苏天晴](entity://e7)"],
            ["人物与对象", "旧钟", "物品", false, "[旧钟](entity://e9)"],
            // 空查询给当前这一章。
            ["章节与段落", "第 2 章", "旧钟与雨", false, "[第 2 章](chapter://2)"],
        ]);
    });

    test("按称呼搜到的对象，搜中的称呼排在“也叫”的最前面", () => {
        const menu = mentionMenu("天晴", {entities: [SU], book: BOOK, at: {chapter: 3}});
        expect(menu.items[0]!.description).toBe("人物 · 也叫 天晴、晴");
    });

    test("数字是章或段：晚于阅读位置的列出但不能选；不存在的章、段不列", () => {
        const at = {chapter: 2, paragraph: 5};
        const places = (query: string) => shown(mentionMenu(query, {entities: [], book: BOOK, at}));
        expect(places("1")).toEqual([["章节与段落", "第 1 章", "雨夜", false, "[第 1 章](chapter://1)"]]);
        expect(places("3")).toEqual([["章节与段落", "第 3 章", "还没读到", true, "[第 3 章](chapter://3)"]]);
        expect(places("2.")).toEqual([["章节与段落", "第 2 章", "旧钟与雨", false, "[第 2 章](chapter://2)"]]);
        expect(places("2.5")).toEqual([["章节与段落", "2.5", "第 2 章第 5 段", false, "[2.5](paragraph://2.5)"]]);
        expect(places("2.6")).toEqual([["章节与段落", "2.6", "还没读到", true, "[2.6](paragraph://2.6)"]]);
        expect(places("2.13")).toEqual([]);
        expect(places("4")).toEqual([]);
        expect(places("0")).toEqual([]);
    });

    test("读完整章的位置：这一章的段都能选，下一章不能", () => {
        const menu = (query: string) => mentionMenu(query, {entities: [], book: BOOK, at: {chapter: 2}});
        expect(menu("2.12").items[0]!.disabled).toBe(false);
        expect(menu("3").items[0]!.disabled).toBe(true);
    });

    test("文字按章标题筛，只筛读到的章；人物还没取到时章节照常列出、菜单显示正在加载；什么都没有时写明", () => {
        const menu = mentionMenu("雨", {entities: null, book: BOOK, at: {chapter: 3}});
        expect(menu.loading).toBe(true);
        expect(menu.items.map(item => item.label)).toEqual(["第 1 章", "第 2 章"]);
        // 第 2 章的标题也有“雨”，但还没读到：列出来就透露了它的标题。
        expect(mentionMenu("雨", {entities: [], book: BOOK, at: {chapter: 1, paragraph: 3}}).items.map(item => item.label)).toEqual(["第 1 章"]);
        expect(mentionMenu("没有的", {entities: [], book: BOOK, at: {chapter: 3}}).emptyText).toBe("没有找到“没有的”");
    });

    test("列表与页头里的问题只留引用的名称", () => {
        expect(mentionPlainText("[苏天晴](entity://e7) 在 [2.5](paragraph://2.5) 知道 [第 3 章](chapter://3) 的事吗？[别的](https://x.y)")).toBe("苏天晴 在 2.5 知道 第 3 章 的事吗？[别的](https://x.y)");
        // 名称里有方括号、反斜杠时插进去的写法带转义，显示时去掉。
        const odd: MentionEntity = {id: "e3", label: "[旧]钟\\", kind: "item", names: ["[旧]钟\\"]};
        const inserted = mentionMenu("", {entities: [odd], book: BOOK, at: {chapter: 1}}).items[0]!.insertText!;
        expect(mentionPlainText(`${inserted} 在哪？`)).toBe("[旧]钟\\ 在哪？");
    });
});

describe("按查询取人物", () => {
    function setup() {
        const asked: string[] = [];
        const waiting = new Map<string, {resolve: (value: MentionEntity[]) => void; reject: (error: Error) => void}>();
        let changes = 0;
        const search = createMentionSearch({
            search: query => {
                asked.push(query);
                return new Promise((resolve, reject) => waiting.set(query, {resolve, reject}));
            },
            onChange: () => (changes += 1),
            delayMs: 0,
        });
        const settle = () => new Promise(resolve => setTimeout(resolve, 0));
        return {asked, waiting, search, settle, changes: () => changes};
    }

    test("连续输入只请求停下来的那个查询；取到后通知，之后直接给缓存", async () => {
        const {asked, waiting, search, settle, changes} = setup();
        expect(search.lookup("苏")).toBeNull();
        expect(search.lookup("苏天")).toBeNull();
        await settle();
        expect(asked).toEqual(["苏天"]);
        waiting.get("苏天")!.resolve([SU]);
        await settle();
        expect(changes()).toBe(1);
        expect(search.lookup("苏天")).toEqual([SU]);
        expect(asked).toEqual(["苏天"]);
    });

    test("位置变了（reset）之前发出、之后才回来的结果丢掉，不通知", async () => {
        const {waiting, search, settle, changes} = setup();
        search.lookup("苏");
        await settle();
        search.reset();
        waiting.get("苏")!.resolve([SU]);
        await settle();
        expect(changes()).toBe(0);
        expect(search.lookup("苏")).toBeNull();
    });

    test("失败的查询先给空、不反复请求；换过查询再回来时重试", async () => {
        const {asked, waiting, search, settle} = setup();
        search.lookup("苏");
        await settle();
        waiting.get("苏")!.reject(new Error("网络"));
        await settle();
        expect(search.lookup("苏")).toEqual([]);
        await settle();
        expect(asked).toEqual(["苏"]);
        search.lookup("旧");
        await settle();
        search.lookup("苏");
        await settle();
        expect(asked).toEqual(["苏", "旧", "苏"]);
    });
});
