/**
 * 问答记录（docs/specs/story/qa.md 输出 15、16，“时序与寿命”“副作用与数据”，F5）与固定一代的书会话。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "./api";
import {StoryError} from "./errors";
import {Library} from "./library";
import {newQaRecordId, QaRecords, type QaRecord} from "./qa-records";
import {makeSampleRoot, smallDataset} from "../../testing/sample";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

/** 临时书库里导入一本两章的小书，书 id `fox`。 */
async function setup(name: string) {
    const sample = await makeSampleRoot(name);
    roots.push(sample.root);
    const lib = new Library(sample.library);
    const file = join(sample.root, "small.json");
    await writeFile(file, JSON.stringify(await smallDataset(2, "小书")));
    const {generation} = await lib.importBook({file, title: "小书", id: "fox"});
    return {lib, file, generation, records: new QaRecords(lib, "fox")};
}

function record(generation: string, overrides: Partial<QaRecord> = {}): QaRecord {
    return {
        id: newQaRecordId(),
        book: "fox",
        generation,
        question: "谁知道地狱猫是谁？",
        at: {chapter: 2, paragraph: 3},
        mode: "graph",
        status: "answered",
        answer: {conclusion: "没人知道", conclusionType: "推断", explanation: "……", evidence: ["1.1"], coverage: "第 1 章"},
        error: null,
        chaptersRead: [1],
        rejections: 0,
        usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null, complete: true},
        ms: 1200,
        model: "test-model",
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof StoryError) return error.code;
        throw error;
    }
    throw new Error("期望失败，却成功了");
}

describe("问答记录", () => {
    test("保存后能列出、显示，会话日志一起写下；新的在前", async () => {
        const {records, generation} = await setup("qa-save");
        const first = record(generation, {id: newQaRecordId(new Date("2026-10-16T10:00:00Z"))});
        const second = record(generation, {id: newQaRecordId(new Date("2026-10-16T11:00:00Z")), question: "第二问"});
        expect(await records.save(first, '{"seq":1}\n')).toEqual({saved: true});
        expect(await records.save(second, '{"seq":1}\n{"seq":2}\n')).toEqual({saved: true});

        expect((await records.list(generation)).map(item => item.question)).toEqual(["第二问", "谁知道地狱猫是谁？"]);
        expect(await records.get(first.id, generation)).toEqual(first);
        expect(await records.sessionLog(second.id, generation)).toBe('{"seq":1}\n{"seq":2}\n');
    });

    test("删除记录同时删除会话日志；之后显示得到 qa_record_not_found（F5）", async () => {
        const {lib, records, generation} = await setup("qa-remove");
        const item = record(generation);
        await records.save(item, "{}\n");
        await records.remove(item.id, generation);
        expect(await records.list(generation)).toEqual([]);
        expect(await readdir(join(lib.bookDir("fox"), "qa"))).toEqual([]);
        expect(await codeOf(records.get(item.id, generation))).toBe("qa_record_not_found");
        expect(await codeOf(records.remove(item.id, generation))).toBe("qa_record_not_found");
    });

    test("不合法的记录 id 不拼进路径", async () => {
        const {records, generation} = await setup("qa-id");
        expect(await codeOf(records.get("../book", generation))).toBe("qa_record_not_found");
        expect(await codeOf(records.remove("../../library", generation))).toBe("qa_record_not_found");
    });

    test("书删除后保存：不保存，也不重新造出书目录", async () => {
        const {lib, records, generation} = await setup("qa-removed");
        await lib.removeBook("fox");
        expect(await records.save(record(generation), "{}\n")).toEqual({saved: false, reason: "book_not_found"});
        expect((await readdir(lib.root)).filter(name => !name.startsWith(".") && name !== "library.json")).toEqual([]);
    });

    test("删除后同 id 重新导入：旧一代的记录不保存；新一代只列自己的", async () => {
        const {lib, file, records, generation: old} = await setup("qa-reimport");
        const before = record(old);
        await records.save(before, "{}\n");
        await lib.removeBook("fox");
        const {generation: fresh} = await lib.importBook({file, title: "小书", id: "fox"});
        expect(await records.save(record(old), "{}\n")).toEqual({saved: false, reason: "book_not_found"});
        const mine = record(fresh, {question: "新一代"});
        await records.save(mine, "{}\n");
        expect((await records.list(fresh)).map(item => item.question)).toEqual(["新一代"]);
        expect(await codeOf(records.get(before.id, fresh))).toBe("qa_record_not_found");
    });

    test("书的格式版本不认识：保存返回 unsupported_format，删除报 unsupported_format，列出照常", async () => {
        const {lib, records, generation} = await setup("qa-format");
        const item = record(generation);
        await records.save(item, "{}\n");
        const metaPath = join(lib.bookDir("fox"), "book.json");
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
        await writeFile(metaPath, JSON.stringify({...meta, format: 99}));

        expect(await records.save(record(generation), "{}\n")).toEqual({saved: false, reason: "unsupported_format"});
        expect(await codeOf(records.remove(item.id, generation))).toBe("unsupported_format");
        expect((await records.list(generation)).map(entry => entry.id)).toEqual([item.id]);
    });
});

describe("固定一代的书会话", () => {
    test("删除并同 id 重新导入之后，已打开的会话仍查旧的一代", async () => {
        const sample = await makeSampleRoot("qa-open-book");
        roots.push(sample.root);
        const api = createStoryApi({library: sample.library});
        const oldFile = join(sample.root, "old.json");
        const newFile = join(sample.root, "new.json");
        await writeFile(oldFile, JSON.stringify(await smallDataset(2, "旧书")));
        await writeFile(newFile, JSON.stringify(await smallDataset(1, "新书")));
        await api.call("book.import", {file: oldFile, title: "旧", id: "fox"});

        const session = await api.openBook("fox");
        await api.call("book.remove", {book: "fox"});
        await api.call("book.import", {file: newFile, title: "新", id: "fox"});

        const pinned = await session.call("book.info", {});
        const current = await api.call("book.info", {book: "fox"});
        expect(pinned.ok && pinned.value.chapters).toBe(2);
        expect(current.ok && current.value.chapters).toBe(1);
        expect(session.generation).not.toBe((await api.library.readMeta("fox")).generation);
    });

    test("只接受书级方法", async () => {
        const sample = await makeSampleRoot("qa-open-book-method");
        roots.push(sample.root);
        const api = createStoryApi({library: sample.library});
        await api.call("book.import", {file: sample.file, title: "样例", id: "fox"});
        const session = await api.openBook(undefined);
        const outcome = await session.call("book.remove", {book: "fox"});
        expect(!outcome.ok && outcome.error.code).toBe("invalid_params");
        expect((await api.library.listBooks()).map(book => book.id)).toEqual(["fox"]);
    });
});
