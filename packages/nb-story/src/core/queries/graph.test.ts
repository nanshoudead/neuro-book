/**
 * 关系图、全书图与故事线（docs/specs/story/queries.md 输出 16、17、18，验收 3）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("graph");
});

afterAll(async () => {
    await book.close();
});

describe("关系图（输出 16、验收 3）", () => {
    test("一对点一条线；默认只画人物与组织", async () => {
        const graph = await book.ok("graph.relations", {at: {chapter: 38}});
        const pairs = graph.edges.map(edge => `${edge.a}|${edge.b}`);
        expect(new Set(pairs).size).toBe(pairs.length);
        expect(graph.nodes.every(node => ["person", "persona", "group"].includes(node.kind))).toBe(true);
        expect(graph.edges.some(edge => edge.relation?.word)).toBe(true);
    });

    test("第 38 章以苏天晴的视角：南嘉鱼与地狱猫之间为 unaware；以南嘉鱼的视角：风信子与南小风之间为 no-record；两个视角 knows 都为 null", async () => {
        const tq = await book.ok("graph.relations", {at: {chapter: 38}, perspective: "e1-1"});
        expect(tq.edges.find(edge => edge.a === "e33-1" && edge.b === "e8-2")!.identity).toBe("unaware");
        expect(tq.edges.every(edge => edge.knows === null)).toBe(true);
        expect(tq.view.unmerged).toContainEqual({a: "e33-1", b: "e8-2", identity: "unaware"});
        const njy = await book.ok("graph.relations", {at: {chapter: 38}, perspective: "e8-2"});
        expect(njy.edges.find(edge => edge.a === "e3-2" && edge.b === "e4-1")!.identity).toBe("no-record");
        expect(njy.edges.every(edge => edge.knows === null)).toBe(true);
    });

    test("读者视角下只有不确定连接的两点为 uncertain；可选视角是有知情记录的人物", async () => {
        const reader = await book.ok("graph.relations", {at: {chapter: 38}});
        expect(reader.edges.find(edge => edge.a === "e30-1" && edge.b === "e8-2")!.identity).toBe("uncertain");
        expect(reader.perspectives.map(item => item.id)).toContain("e1-1");
        expect(reader.edges.every(edge => edge.knows !== null)).toBe(true);
    });

    test("点带它的其他称呼（搜索按别名查）：不含显示名；阅读位置之前还没出现的称呼不带出", async () => {
        const late = await book.ok("graph.relations", {at: {chapter: 38}});
        const owner = late.nodes.find(node => node.names.includes("心月狐"));
        expect(owner).toBeDefined();
        expect(owner!.names).not.toContain(owner!.label);
        expect(new Set(owner!.names).size).toBe(owner!.names.length);
        // “心月狐”第 8 章第 48 段才出现：读到第 7 章时哪个点都不带它。
        const early = await book.ok("graph.relations", {at: {chapter: 7}});
        expect(early.nodes.some(node => node.names.includes("心月狐"))).toBe(false);
        // 全书图的对象点同样带称呼，别的类型的点没有。
        const bookGraph = await book.ok("graph.book", {at: {chapter: 38}});
        expect(bookGraph.nodes.find(node => node.id === owner!.id)?.names).toContain("心月狐");
        expect(bookGraph.nodes.filter(node => node.type !== "entity").every(node => node.names === undefined)).toBe(true);
    });

    test("同场门槛以下的同场数为 0", async () => {
        const graph = await book.ok("graph.relations", {at: {chapter: 38}, minTogether: 5});
        expect(graph.edges.every(edge => edge.together === 0 || edge.together >= 5)).toBe(true);
    });
});

describe("全书图与故事线（输出 17、18）", () => {
    test("按主线聚合时主线与对象的线带出场情节数，用的是当前这一批", async () => {
        const graph = await book.ok("graph.book", {at: {chapter: 38}});
        const arcs = (await book.ok("arcs.list", {at: {chapter: 38}})).arcs.map(arc => arc.id).sort();
        expect(graph.nodes.filter(node => node.type === "arc").map(node => node.id).sort()).toEqual(arcs);
        expect(graph.edges.filter(edge => edge.type === "participates").every(edge => edge.count >= 1)).toBe(true);
    });

    test("故事线的行在同一代、同一位置下固定；点都落在已选的行上", async () => {
        const first = await book.ok("graph.storyline", {at: {chapter: 38}});
        const second = await book.ok("graph.storyline", {at: {chapter: 38}});
        expect(second).toEqual(first);
        const lanes = new Set(first.lanes.map(lane => lane.id));
        expect(first.dots.every(dot => lanes.has(dot.lane) && dot.chapter <= 38)).toBe(true);
    });
});
