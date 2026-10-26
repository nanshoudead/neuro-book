/**
 * 原文（docs/specs/story/queries.md 输出 14、验收 7）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../../testing/api";
import {sampleDataset} from "../../../testing/sample";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("source");
});

afterAll(async () => {
    await book.close();
});

describe("原文（输出 14、验收 7）", () => {
    const at = {chapter: 38, paragraph: 57};

    test("读第 39 章得到 beyond_position", async () => {
        expect(await book.fail("source.read", {at, from: {chapter: 39}})).toBe("beyond_position");
        expect(await book.fail("source.records", {at, chapter: 39, paragraph: 1})).toBe("beyond_position");
    });

    test("本章 P 之后的段落有原文、记录条数为 0，引用这一段的记录为空", async () => {
        const {paragraphs} = await book.ok("source.read", {at, from: {chapter: 38, paragraph: 60}});
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0]!.text.length).toBeGreaterThan(0);
        expect(paragraphs[0]!.recordCount).toBe(0);
        expect((await book.ok("source.records", {at, chapter: 38, paragraph: 60})).records).toEqual([]);
        const full = await book.ok("source.read", {at: {chapter: 38}, from: {chapter: 38}});
        expect(full.paragraphs.slice(57).some(paragraph => paragraph.recordCount > 0)).toBe(true);
    });

    test("本章 P 之后的段落只标 P 时已可见的称呼写法：8.47 时第 8 章后面的“心月狐”不标", async () => {
        const p = {chapter: 8, paragraph: 47};
        const dataset = await sampleDataset();
        const visibleNames = new Map(dataset.entities.map(entity => [entity.id, new Set(entity.names.filter(name => name.at.chapter < p.chapter || (name.at.chapter === p.chapter && name.at.paragraph <= p.paragraph)).map(name => name.text))]));
        const roster = await book.ok("entities.list", {at: p, limit: 500});
        const membersOf = new Map(roster.items.map(item => [item.id, item.entities]));
        const {paragraphs} = await book.ok("source.read", {at: p, from: {chapter: 8, paragraph: 48}});
        const names = paragraphs.flatMap(paragraph => paragraph.names);
        expect(names.length).toBeGreaterThan(0);
        expect(names.map(name => name.text)).not.toContain("心月狐");
        for (const name of names) {
            expect((membersOf.get(name.entity) ?? []).some(id => visibleNames.get(id)?.has(name.text))).toBe(true);
        }
    });

    test("从第 48 段开始、到第 81 段才完整的段落概要不出现在第 48 段上", async () => {
        const at57 = await book.ok("source.read", {at, from: {chapter: 38, paragraph: 48}});
        expect(at57.paragraphs[0]!.beat).toBeNull();
        const at81 = await book.ok("source.read", {at: {chapter: 38, paragraph: 81}, from: {chapter: 38, paragraph: 48}});
        expect(at81.paragraphs[0]!.beat).toEqual(expect.objectContaining({from: 48, to: 81}));
    });

    test("段落记录条数等于引用这一段的记录数", async () => {
        const {paragraphs} = await book.ok("source.read", {at, from: {chapter: 38, paragraph: 40}, to: {chapter: 38, paragraph: 57}});
        for (const paragraph of paragraphs) {
            const {records} = await book.ok("source.records", {at, chapter: 38, paragraph: paragraph.paragraph});
            expect(records.length).toBe(paragraph.recordCount);
        }
    });
});
