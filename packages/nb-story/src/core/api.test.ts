/**
 * 查询接口的编排：参数校验、书与阅读位置、游标、阅读状态、书的信息与统计（docs/specs/story/queries.md
 * 阅读位置的规则、输出 2、19，时序第 4 条，失败 F2、F5、F9、F10）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {join} from "node:path";

import {openTestBook, type TestBook} from "../../testing/api";
import {SAMPLE_TITLE} from "../../testing/sample";
import {createStoryApi} from "./api";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("api");
});

afterAll(async () => {
    await book.close();
});

describe("参数与阅读位置", () => {
    test("参数不符合 schema 报 invalid_params：多余字段、类型不对、未知方法", async () => {
        expect(await book.fail("book.info", {extra: 1})).toBe("invalid_params");
        expect(await book.fail("book.info", {at: "38.57"})).toBe("invalid_params");
        expect(await book.fail("entities.list", {limit: 501})).toBe("invalid_params");
        expect(await book.fail("nope.method" as "book.info", {})).toBe("invalid_params");
    });

    test("不给 at 读到全书已抽取的最后位置；只给章表示读完这一章", async () => {
        expect((await book.ok("book.info", {})).at).toEqual({chapter: 100, paragraph: 94});
        expect((await book.ok("book.info", {at: {chapter: 1}})).at).toEqual({chapter: 1, paragraph: 76});
        expect((await book.ok("book.info", {at: {chapter: 38, paragraph: 57}})).at).toEqual({chapter: 38, paragraph: 57});
    });

    test("章或段超出全书范围、或为 0 与负数报 position_out_of_range（F5）", async () => {
        for (const at of [{chapter: 0}, {chapter: 101}, {chapter: -1}, {chapter: 1, paragraph: 0}, {chapter: 1, paragraph: 77}]) {
            expect(await book.fail("book.info", {at})).toBe("position_out_of_range");
        }
    });

    test("书库里不止一本书时省略 book 报 book_ambiguous（F2）", async () => {
        const second = createStoryApi({library: book.library});
        const imported = await second.call("book.import", {file: join(book.root, "sample-100ch.json"), title: SAMPLE_TITLE, id: "fox-copy"});
        expect(imported.ok).toBe(true);
        expect(await book.fail("book.info", {})).toBe("book_ambiguous");
        expect((await book.ok("book.info", {book: "fox"})).id).toBe("fox");
        await second.call("book.remove", {book: "fox-copy"});
        expect((await book.ok("book.info", {})).id).toBe("fox");
    });
});

describe("书的信息与统计（输出 1、2）", () => {
    test("目录里 P 所在章之后的章只有章号", async () => {
        const info = await book.ok("book.info", {at: {chapter: 7}});
        expect(info.toc).toHaveLength(100);
        expect(info.toc.slice(0, 7).every(item => typeof item.title === "string")).toBe(true);
        expect(info.toc.slice(7).every(item => item.title === null)).toBe(true);
    });

    test("可见条数随位置变，全书抽取统计不随位置变并标明覆盖全书", async () => {
        const early = await book.ok("book.stats", {at: {chapter: 7}});
        const late = await book.ok("book.stats", {at: {chapter: 38}});
        expect(early.visible.statements).toBeLessThan(late.visible.statements!);
        expect(early.extraction).toEqual(late.extraction);
        expect(early.extraction.scope).toBe("book");
    });
});

describe("分页游标（时序第 4 条、F10）", () => {
    test("下一页接着上一页，最后一页 next 为 null", async () => {
        const first = await book.ok("entities.list", {at: {chapter: 38}, limit: 10});
        const second = await book.ok("entities.list", {at: {chapter: 38}, limit: 10, cursor: first.next!});
        const all = await book.ok("entities.list", {at: {chapter: 38}, limit: 20});
        expect([...first.items, ...second.items].map(item => item.id)).toEqual(all.items.map(item => item.id));
        const last = await book.ok("entities.list", {at: {chapter: 38}, limit: 500});
        expect(last.next).toBeNull();
    });

    test("参数不同时旧游标报 cursor_invalid；写坏的游标同样处理", async () => {
        const first = await book.ok("entities.list", {at: {chapter: 38}, limit: 10});
        expect(await book.fail("entities.list", {at: {chapter: 39}, limit: 10, cursor: first.next!})).toBe("cursor_invalid");
        expect(await book.fail("entities.list", {at: {chapter: 38}, limit: 10, cursor: "garbage"})).toBe("cursor_invalid");
    });

    test("另一个进程（新建的接口实例）用同一游标照常取到下一页", async () => {
        const first = await book.ok("entities.list", {at: {chapter: 38}, limit: 10});
        const other = createStoryApi({library: book.library});
        const next = await other.call("entities.list", {at: {chapter: 38}, limit: 10, cursor: first.next!});
        expect(next.ok).toBe(true);
    });

    test("书已删除未重导入时报 cursor_invalid；同 id 换了一代也报 cursor_invalid", async () => {
        const isolated = await openTestBook("api-cursor");
        try {
            const first = await isolated.ok("entities.list", {limit: 10});
            await isolated.ok("book.remove", {book: "fox"});
            expect(await isolated.fail("entities.list", {limit: 10, cursor: first.next!})).toBe("cursor_invalid");
            expect(await isolated.fail("entities.list", {limit: 10})).toBe("book_not_found");
            await isolated.ok("book.import", {file: join(isolated.root, "sample-100ch.json"), title: SAMPLE_TITLE, id: "fox"});
            expect(await isolated.fail("entities.list", {limit: 10, cursor: first.next!})).toBe("cursor_invalid");
        } finally {
            await isolated.close();
        }
    });
});

describe("阅读状态（输出 19）", () => {
    test("整份写入后读回；位置在这本书里落不定时报 position_out_of_range", async () => {
        const saved = await book.ok("reading.set", {position: {chapter: 38, paragraph: 57}, view: {page: "relations", entity: "e8-2"}});
        expect(await book.ok("reading.get", {})).toEqual(saved);
        expect(await book.fail("reading.set", {position: {chapter: 200}, view: null})).toBe("position_out_of_range");
    });
});
