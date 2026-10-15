/**
 * 秘密矩阵（docs/specs/story/queries.md 输出 9、验收 4）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("secrets");
});

afterAll(async () => {
    await book.close();
});

describe("秘密矩阵（输出 9、验收 4）", () => {
    test("第 38 章“深蓝猫娘是南嘉鱼的反派身份”一行的读者格是知道，出处是 37.8，不是第 30 章的怀疑", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 38}});
        const row = matrix.rows.find(item => item.id === "x30-1")!;
        const reader = row.cells.find(cell => cell.column === "reader")!;
        expect(reader).toEqual({column: "reader", state: "knows", ref: "37.8"});
        expect(row.revealedAt).toBe("37.8");
    });

    test("37.7 时读者还只是怀疑", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 37, paragraph: 7}});
        const reader = matrix.rows.find(item => item.id === "x30-1")!.cells.find(cell => cell.column === "reader")!;
        expect(reader.state).toBe("suspects");
        expect(reader.ref).toMatch(/^30\./u);
    });

    test("人物各行取这个人最新的状态；没有记录的格给“没有记录”", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 38}});
        const cells = matrix.rows.flatMap(row => row.cells.filter(cell => cell.column !== "reader"));
        expect(cells.some(cell => cell.state === "no-record" && cell.ref === null)).toBe(true);
        const tq = matrix.rows.find(row => row.id === "x30-1")!.cells.find(cell => cell.column === "e1-1")!;
        expect(tq.state).toBe("unaware");
    });

    test("第 7 章时没有第 8 章及以后才有的秘密", async () => {
        const matrix = await book.ok("secrets.matrix", {at: {chapter: 7}});
        expect(matrix.rows.map(row => row.id).sort()).toEqual(["x21-1", "x4-1", "x6-1"]);
    });
});
