/**
 * 数值对账（docs/specs/story/queries.md 输出 10、验收 5）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";
import {smallDataset} from "../../../testing/sample";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("ledger");
});

afterAll(async () => {
    await book.close();
});

describe("数值对账（输出 10、验收 5）", () => {
    test("第 38 章神典石流水里，38.36 原文报数 1300 的一笔差额为 +800", async () => {
        const result = await book.ok("ledger.track", {at: {chapter: 38}, track: "神典石"});
        const row = result.entries.find(entry => entry.refs[0] === "38.36")!;
        expect(row.value).toBe(1300);
        expect(row.balance).toBe(1300);
        expect(row.gap).toBe(800);
        expect(result.track.mismatches).toBe(result.entries.filter(entry => entry.gap !== null && entry.gap !== 0).length);
    });

    test("第一次报数之前余额是相对值；首笔收支同时报出余额时就是绝对值", async () => {
        const dataset = await smallDataset(3, "ledger");
        const base = {owner: "e1-1", basis: "explicit" as const, reason: "测试", check: null, evidence: [{chapter: 3, from: 2, to: 2}]};
        dataset.ledger = [
            {...base, id: "l-a1", track: "金币", op: "gain", amount: 10, at: {chapter: 3, paragraph: 2}},
            {...base, id: "l-a2", track: "金币", op: "spend", amount: 3, at: {chapter: 3, paragraph: 3}},
            {...base, id: "l-a3", track: "金币", op: "set", value: 20, at: {chapter: 3, paragraph: 4}},
            {...base, id: "l-b1", track: "银币", op: "gain", amount: 1000, value: 2000, at: {chapter: 3, paragraph: 2}},
            {...base, id: "l-b2", track: "银币", op: "spend", amount: 500, value: 1600, at: {chapter: 3, paragraph: 3}},
        ];
        const small = await openTestBook("ledger-relative", dataset);
        try {
            const gold = await small.ok("ledger.track", {track: "金币"});
            expect(gold.entries.map(entry => [entry.balance, entry.relative, entry.gap])).toEqual([
                [10, true, null],
                [7, true, null],
                [20, false, null],
            ]);
            const silver = await small.ok("ledger.track", {track: "银币"});
            expect(silver.entries.map(entry => [entry.balance, entry.relative, entry.gap])).toEqual([
                [2000, false, null],
                [1600, false, 100],
            ]);
        } finally {
            await small.close();
        }
    });

    test("名目有几个主人时要指定 owner；没有这项时报 entity_not_found", async () => {
        expect(await book.fail("ledger.track", {at: {chapter: 100}, track: "现金"})).toBe("entity_ambiguous");
        expect((await book.ok("ledger.track", {at: {chapter: 100}, track: "现金", owner: "e1-1"})).track.owner.id).toBe("e1-1");
        expect(await book.fail("ledger.track", {at: {chapter: 1}, track: "现金"})).toBe("entity_not_found");
    });

    test("任务按名目分出、道具用得到与用掉记账", async () => {
        const tracks = (await book.ok("ledger.tracks", {at: {chapter: 100}})).tracks;
        expect(tracks.find(track => track.name === "任务：夙愿")!.kind).toBe("task");
        expect(tracks.find(track => track.name === "道具")!.kind).toBe("item");
        expect(tracks.find(track => track.name === "神典石")!.kind).toBe("resource");
    });
});
