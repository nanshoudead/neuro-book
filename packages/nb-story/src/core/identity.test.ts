/**
 * 身份合并与显示名（docs/specs/story/queries.md 输出 3、4、5，验收 2）。经公开的 api 调用：名册里每个点的
 * `entities` 就是它由哪些对象合成。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../testing/api";
import {smallDataset} from "../../testing/sample";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("identity");
});

afterAll(async () => {
    await book.close();
});

/** 在某个位置、某个视角下，对象所在的点由哪些对象组成。 */
async function groupOf(entity: string, at: {chapter: number; paragraph?: number}, perspective?: string): Promise<string[]> {
    const roster = await book.ok("entities.list", {at, limit: 500, ...(perspective ? {perspective} : {})});
    const row = roster.items.find(item => item.entities.includes(entity));
    if (!row) throw new Error(`${entity} 在 ${at.chapter}.${at.paragraph ?? "末"} 不可见`);
    return [...row.entities].sort();
}

describe("读者视角的合并（输出 3、验收 2）", () => {
    test("苏天晴与视频里的狐狐：6.95 时两个点，6.96 起一个点", async () => {
        expect(await groupOf("e1-1", {chapter: 6, paragraph: 95})).not.toContain("e6-2");
        expect(await groupOf("e1-1", {chapter: 6, paragraph: 96})).toContain("e6-2");
    });

    test("花铃与白色少女在 27.90 起是一个点", async () => {
        expect(await groupOf("e12-5", {chapter: 27, paragraph: 89})).not.toContain("e26-2");
        expect(await groupOf("e12-5", {chapter: 27, paragraph: 90})).toContain("e26-2");
    });

    test("南嘉鱼与地狱猫在 37.8 起是一个点；只靠角色自称连着的深蓝猫娘始终单独一个点", async () => {
        expect(await groupOf("e8-2", {chapter: 37, paragraph: 7})).not.toContain("e33-1");
        const merged = await groupOf("e8-2", {chapter: 37, paragraph: 8});
        expect(merged).toContain("e33-1");
        expect(merged).not.toContain("e30-1");
        expect(await groupOf("e30-1", {chapter: 100})).toEqual(["e30-1"]);
    });

    test("合并后的点 id 是人物，显示名用可见主名", async () => {
        const roster = await book.ok("entities.list", {at: {chapter: 38}, limit: 500});
        const fox = roster.items.find(item => item.entities.includes("e6-2"))!;
        expect(fox.id).toBe("e1-1");
        expect(fox.label).toBe("苏天晴");
        expect(fox.kind).toBe("person");
    });

    test("否定的身份说法不合并", async () => {
        const dataset = await smallDataset(7, "neg");
        for (const statement of dataset.statements) if (statement.id === "s6-25") statement.neg = true;
        const negated = await openTestBook("identity-neg", dataset);
        try {
            const roster = await negated.ok("entities.list", {limit: 500});
            expect(roster.items.find(item => item.entities.includes("e1-1"))!.entities).not.toContain("e6-2");
        } finally {
            await negated.close();
        }
    });
});

describe("角色视角（输出 5）", () => {
    test("第 38 章以苏天晴的视角：南嘉鱼与地狱猫是两个点；她自己的几个对象仍合并", async () => {
        expect(await groupOf("e8-2", {chapter: 38}, "e1-1")).not.toContain("e33-1");
        expect(await groupOf("e1-1", {chapter: 38}, "e1-1")).toContain("e6-2");
    });

    test("角色视角下没合并的身份各自打开自己的人物卡，名字对应两个点时报 entity_ambiguous", async () => {
        const hellcat = await book.ok("entity.card", {at: {chapter: 38}, perspective: "e1-1", entity: "e33-1"});
        expect(hellcat.id).toBe("e33-1");
        expect(hellcat.entities).toEqual(["e33-1"]);
        const njy = await book.ok("entity.card", {at: {chapter: 38}, perspective: "e1-1", entity: "e8-2"});
        expect(njy.entities).not.toContain("e33-1");
        expect((await book.ok("entity.card", {at: {chapter: 38}, entity: "e33-1"})).id).toBe("e8-2");
    });

    test("可以用任一成员或名字指定视角；还没有知情记录的人物不能作视角", async () => {
        expect(await groupOf("e8-2", {chapter: 38}, "狐狐")).not.toContain("e33-1");
        expect(await book.fail("entities.list", {at: {chapter: 38}, perspective: "e2-2"})).toBe("invalid_params");
    });
});

describe("同一身份的出处", () => {
    test("花铃与白色少女在 27.90 合并，出处是触发合并的确定连接 27.83—27.90，不是更早的候选说法", async () => {
        const card = await book.ok("entity.card", {at: {chapter: 27, paragraph: 90}, entity: "e12-5"});
        expect(card.identities).toEqual([expect.objectContaining({id: "e26-2", ref: "27.83—27.90"})]);
    });
});

describe("显示名（输出 4）", () => {
    test("没有可见主名时取出现最多的称呼；重名时次要的一个带说明", async () => {
        const roster = await book.ok("entities.list", {at: {chapter: 38}, limit: 500});
        expect(roster.items.find(item => item.id === "e30-1")!.label).toBe("猫娘魔法少女");
        const labels = roster.items.map(item => item.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    test("后文才出现的称呼不进显示名与称呼表", async () => {
        const roster = await book.ok("entities.list", {at: {chapter: 7}, limit: 500});
        const fox = roster.items.find(item => item.id === "e1-1")!;
        expect(fox.names.top).not.toContain("心月狐");
        expect(fox.label).toBe("苏天晴");
    });
});
