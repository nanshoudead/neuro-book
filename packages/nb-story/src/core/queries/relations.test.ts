/**
 * 两个对象之间的关系（docs/specs/story/queries.md 输出 20、21）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("relations");
});

afterAll(async () => {
    await book.close();
});

describe("关系一览（输出 20）", () => {
    test("第 50 章苏天晴：人物在前，南嘉鱼是朋友、一句说明只涉及两人；导购员只有一起出场，写出那段情节", async () => {
        const {items} = await book.ok("entity.relations", {at: {chapter: 50}, entity: "e1-1"});
        expect(["person", "persona"]).toContain(items[0]!.other.kind);
        const njy = items.find(item => item.other.label === "南嘉鱼")!;
        expect(njy.strength).toBe("relation");
        expect(njy.word).toBe("朋友");
        expect(njy.summary!.text).toContain("苏天晴");
        const guide = items.find(item => item.other.id === "e47-5")!;
        expect(guide.strength).toBe("together");
        expect(guide.summary).toBeNull();
        expect(guide.lastEpisode).toEqual({id: "p47-2", title: expect.any(String), chapter: 47});
        // 人物卡关系页签的条数与这份列表一致。
        const card = await book.ok("entity.card", {at: {chapter: 50}, entity: "e1-1"});
        expect(card.counts.relations).toBe(items.length);
    });

    test("和概念之间的身份连接不排在人物前面", async () => {
        const {items} = await book.ok("entity.relations", {at: {chapter: 50}, entity: "e1-1"});
        const concept = items.findIndex(item => item.other.kind === "concept" && item.identity !== null);
        expect(concept).toBeGreaterThan(0);
        expect(items[concept]!.strength).not.toBe("identity");
    });

    test("第 46 章导购员还没出场，不在苏天晴的关系里", async () => {
        const {items} = await book.ok("entity.relations", {at: {chapter: 46}, entity: "e1-1"});
        expect(items.some(item => item.other.id === "e47-5")).toBe(false);
    });
});

describe("两人之间（输出 21）", () => {
    test("苏天晴与导购员：没有说法，一起出场一段，导购员听说过苏天晴的事", async () => {
        const detail = await book.ok("entity.relation", {at: {chapter: 50}, entity: "e1-1", other: "e47-5"});
        expect(detail.statements).toEqual([]);
        expect(detail.episodes.map(item => item.id)).toEqual(["p47-2"]);
        expect(detail.knows!.ba.some(item => item.state === "heard")).toBe(true);
    });

    test("苏天晴视角下还没认出地狱猫：两人一起出场的情节按化名算（p37-1）；角色视角不给认知", async () => {
        const detail = await book.ok("entity.relation", {at: {chapter: 38}, entity: "e1-1", other: "e33-1", perspective: "e1-1"});
        expect(detail.episodes.map(item => item.id)).toContain("p37-1");
        expect(detail.knows).toBeNull();
    });
});
