/**
 * 书库：导入、删除、一代、阅读状态与书库版本（docs/specs/story/queries.md 的“状态与转换”“副作用与数据”、
 * 验收 10，失败 F1 到 F4、F11）。并发与中途结束进程都用真的子进程。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {watch} from "node:fs";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {StoryError} from "../src/core/errors";
import {Library} from "../src/core/library";
import {makeSampleRoot, SAMPLE_TITLE} from "./fixtures/sample";

const IMPORT_CHILD = join(import.meta.dir, "fixtures", "import-child.ts");
const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

async function setup(name: string) {
    const sample = await makeSampleRoot(name);
    roots.push(sample.root);
    return {...sample, lib: new Library(sample.library)};
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

function runImportChild(library: string, file: string, id: string) {
    return Bun.spawn(["bun", IMPORT_CHILD, library, file, SAMPLE_TITLE, id], {stdout: "pipe", stderr: "inherit"});
}

describe("导入与删除", () => {
    test("导入后出现在书库里，带新的一代与目录信息", async () => {
        const {lib, file} = await setup("import");
        const result = await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        const books = await lib.listBooks();
        expect(books.map(book => book.id)).toEqual(["fox"]);
        expect(books[0]!.generation).toBe(result.generation);
        expect(books[0]!.chapters).toBe(100);
        expect(books[0]!.paragraphs[0]).toBe(76);
        expect(books[0]!.extractedThrough).toEqual({chapter: 100, paragraph: 94});
        expect((await lib.readDataset(books[0]!)).sources).toHaveLength(100);
    });

    test("不给 id 时由书名得到 id；同一书名再导入报 book_exists（F3）", async () => {
        const {lib, file} = await setup("import-title");
        const first = await lib.importBook({file, title: SAMPLE_TITLE});
        expect(first.id).toMatch(/^book-[0-9a-f]{8}$/u);
        expect(await codeOf(lib.importBook({file, title: SAMPLE_TITLE}))).toBe("book_exists");
        expect((await lib.importBook({file, title: "Fox Book"})).id).toBe("fox-book");
    });

    test("不是 V9 记忆图的文件报 unsupported_format，书库不变（F4）", async () => {
        const {lib, root} = await setup("import-bad");
        const bad = join(root, "bad.json");
        await writeFile(bad, JSON.stringify({schema: "neurobook.memory.v7"}));
        expect(await codeOf(lib.importBook({file: bad, title: "x"}))).toBe("unsupported_format");
        await writeFile(bad, "{not json");
        expect(await codeOf(lib.importBook({file: bad, title: "x"}))).toBe("unsupported_format");
        expect(await lib.listBooks()).toEqual([]);
    });

    test("删除后不再列出、按 id 查询报 book_not_found；同 id 重新导入是新的一代（F1）", async () => {
        const {lib, file} = await setup("remove");
        const first = await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        await lib.removeBook("fox");
        expect(await lib.listBooks()).toEqual([]);
        expect(await codeOf(lib.readMeta("fox"))).toBe("book_not_found");
        expect(await codeOf(lib.removeBook("fox"))).toBe("book_not_found");
        const second = await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        expect(second.generation).not.toBe(first.generation);
    });

    test("读数据时这本书已换了一代，报 book_not_found 而不是读到新一代", async () => {
        const {lib, file} = await setup("generation");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        const old = await lib.readMeta("fox");
        await lib.removeBook("fox");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        expect(await codeOf(lib.readDataset(old))).toBe("book_not_found");
    });

    test("省略 book：一本书时取它，没有书或多本书时报错（F2）", async () => {
        const {lib, file} = await setup("resolve");
        expect(await codeOf(lib.resolveBookId(undefined))).toBe("book_not_found");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        expect(await lib.resolveBookId(undefined)).toBe("fox");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox-2"});
        expect(await codeOf(lib.resolveBookId(undefined))).toBe("book_ambiguous");
    });

    test("同一个 id 两个进程并发导入，恰有一次成功（验收 10）", async () => {
        const {library, file} = await setup("concurrent");
        const children = [runImportChild(library, file, "fox"), runImportChild(library, file, "fox")];
        const outputs = await Promise.all(children.map(async child => (await new Response(child.stdout).text()).trim()));
        await Promise.all(children.map(child => child.exited));
        expect(outputs.filter(line => line.startsWith("ok fox ")).length).toBe(1);
        expect(outputs.filter(line => line === "error book_exists").length).toBe(1);
        expect((await new Library(library).listBooks()).map(book => book.id)).toEqual(["fox"]);
    });

    test("导入中途结束进程，书库里没有半本书（验收 10）", async () => {
        const {library, file} = await setup("killed");
        await mkdir(library, {recursive: true});
        let caughtMidway = 0;
        // 进程在写临时目录时被杀的时机要靠运气碰上：反复导入，看到临时目录出现就立刻杀掉，
        // 每一次都核对书库要么没有这本书、要么是完整的一本。
        for (let attempt = 0; attempt < 20 && caughtMidway < 3; attempt += 1) {
            const id = `fox-${attempt}`;
            const watcher = watch(library);
            const child = runImportChild(library, file, id);
            watcher.on("change", (_event, name) => {
                if (String(name).startsWith(".importing-")) child.kill("SIGKILL");
            });
            await child.exited;
            watcher.close();
            const lib = new Library(library);
            const listed = (await lib.listBooks()).find(book => book.id === id);
            if (listed) {
                expect((await lib.readDataset(listed)).sources).toHaveLength(100);
            } else {
                caughtMidway += 1;
                expect(await codeOf(lib.readMeta(id))).toBe("book_not_found");
            }
        }
        expect(caughtMidway).toBeGreaterThan(0);
        // 留下的临时目录不算书；下一次导入照常成功。
        expect((await readdir(library)).some(name => name.startsWith(".importing-"))).toBe(true);
        await new Library(library).importBook({file, title: SAMPLE_TITLE, id: "after"});
        expect((await new Library(library).listBooks()).map(book => book.id)).toContain("after");
    });
});

describe("阅读状态", () => {
    test("从没存过时是全书开头、界面状态为空", async () => {
        const {lib, file} = await setup("reading-empty");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        expect(await lib.getReading("fox")).toEqual({position: {chapter: 1}, view: null, savedAt: null});
    });

    test("整份替换：后写入的覆盖先写入的（输出 19）", async () => {
        const {lib, file} = await setup("reading-replace");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        await lib.setReading("fox", {chapter: 38, paragraph: 57}, {page: "relations", entity: "e1"});
        await lib.setReading("fox", {chapter: 7}, {page: "roster"});
        const state = await lib.getReading("fox");
        expect(state.position).toEqual({chapter: 7});
        expect(state.view).toEqual({page: "roster"});
        expect(typeof state.savedAt).toBe("string");
    });

    test("两次并发写入都成功，读到的是其中完整的一份", async () => {
        const {lib, file} = await setup("reading-race");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        const a = {page: "a", items: Array.from({length: 200}, (_, i) => `a${i}`)};
        const b = {page: "b", items: Array.from({length: 200}, (_, i) => `b${i}`)};
        await Promise.all([lib.setReading("fox", {chapter: 1}, a), lib.setReading("fox", {chapter: 2}, b)]);
        const state = await lib.getReading("fox");
        expect([JSON.stringify(a), JSON.stringify(b)]).toContain(JSON.stringify(state.view));
        // 位置与界面状态出自同一次写入，不会一半来自 a、一半来自 b。
        expect(state.position.chapter).toBe((state.view as {page: string}).page === "a" ? 1 : 2);
    });

    test("界面状态超过 64 KiB 报 state_too_large，原来的状态不变（F11）", async () => {
        const {lib, file} = await setup("reading-large");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        await lib.setReading("fox", {chapter: 3}, {page: "roster"});
        expect(await codeOf(lib.setReading("fox", {chapter: 4}, {blob: "x".repeat(64 * 1024)}))).toBe("state_too_large");
        expect((await lib.getReading("fox")).position).toEqual({chapter: 3});
    });

    test("删除书时阅读状态一起删除", async () => {
        const {lib, file} = await setup("reading-remove");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        await lib.setReading("fox", {chapter: 3}, null);
        await lib.removeBook("fox");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        expect((await lib.getReading("fox")).savedAt).toBeNull();
    });
});

describe("书库版本", () => {
    test("书库版本不认识时只读：列出照常，写入报 unsupported_format（F4）", async () => {
        const {lib, file, library} = await setup("format");
        await lib.importBook({file, title: SAMPLE_TITLE, id: "fox"});
        await writeFile(join(library, "library.json"), JSON.stringify({format: 2}));
        expect((await lib.listBooks()).map(book => book.id)).toEqual(["fox"]);
        expect(await codeOf(lib.importBook({file, title: SAMPLE_TITLE, id: "other"}))).toBe("unsupported_format");
        expect(await codeOf(lib.setReading("fox", {chapter: 1}, null))).toBe("unsupported_format");
        expect(await codeOf(lib.removeBook("fox"))).toBe("unsupported_format");
    });
});
