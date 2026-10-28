/**
 * 修订文件的跨进程写入（docs/specs/story/revisions.md 的“时序与寿命”与验收 8）：用真实子进程并发写，用最后落盘的文件核对。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {openTestBook, type TestBook} from "../../../testing/api";
import {StoryError} from "../errors";
import {writeOverlay} from "./store";

const CHILD = join(import.meta.dir, "..", "..", "..", "testing", "revise-child.ts");
let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("overlay-store");
});
afterAll(async () => {
    await book.close();
});

async function run(evidence: string): Promise<{code: number; version: number; stderr: string}> {
    const child = Bun.spawn(["bun", CHILD, book.library, "fox", evidence], {stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, version: Number(stdout.trim()), stderr};
}

describe("跨进程并发写入", () => {
    test("八个进程同时各写一条：全部成功、全部保留，版本号各不相同且连续，没有留下临时文件", async () => {
        const results = await Promise.all(Array.from({length: 8}, (_, index) => run(`10.${index + 1}`)));
        expect(results.map(item => item.stderr).join("")).toBe("");
        expect(results.every(item => item.code === 0)).toBe(true);
        const versions = results.map(item => item.version).sort((a, b) => a - b);
        expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        const list = await book.ok("revisions.list", {at: {chapter: 100}, limit: 500, state: "adopted"});
        expect(list.counts.adopted).toBe(8);
        expect(new Set(list.items.map(item => item.evidence)).size).toBe(8);
        const files = (await readdir(join(book.library, "fox"))).filter(name => name.startsWith("revisions-") || name.endsWith(".tmp"));
        expect(files.filter(name => name.endsWith(".tmp"))).toEqual([]);
        expect(files.filter(name => name.startsWith("revisions-")).sort()).toHaveLength(8);
    });
});

describe("换代与写坏的文件", () => {
    test("书目录已经是新一代：旧一代的写入报 book_not_found，新一代的修订文件原样不动", async () => {
        const dir = join(book.library, "gen-race");
        await mkdir(dir, {recursive: true});
        await writeFile(join(dir, "book.json"), JSON.stringify({generation: "new"}));
        const mine = JSON.stringify({format: 1, generation: "new", version: 1, items: []});
        await writeFile(join(dir, "revisions-1.json"), mine);
        const error = await writeOverlay(dir, "old", current => ({items: current.items, result: 1})).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(StoryError);
        expect((error as StoryError).code).toBe("book_not_found");
        expect(await readFile(join(dir, "revisions-1.json"), "utf8")).toBe(mine);
        expect((await readdir(dir)).sort()).toEqual(["book.json", "revisions-1.json"]);
    });

    test("目标版本号被别的一代遗留的文件占着、书目录还是这一代：删掉它再发布；最高版本是写坏的 JSON：同样被换掉", async () => {
        const dir = join(book.library, "stray");
        await mkdir(dir, {recursive: true});
        await writeFile(join(dir, "book.json"), JSON.stringify({generation: "g"}));
        await writeFile(join(dir, "revisions-1.json"), JSON.stringify({format: 1, generation: "别的一代", version: 1, items: []}));
        const first = await writeOverlay(dir, "g", current => ({items: current.items, result: current.version}));
        expect(first.file.version).toBe(1);
        expect(JSON.parse(await readFile(join(dir, "revisions-1.json"), "utf8")).generation).toBe("g");
        await writeFile(join(dir, "revisions-2.json"), "{坏的");
        const second = await writeOverlay(dir, "g", current => ({items: current.items, result: current.version}));
        expect(second.file.version).toBe(2);
        expect(JSON.parse(await readFile(join(dir, "revisions-2.json"), "utf8")).generation).toBe("g");
    });

    test("发布之后写入的临时文件不留下；格式版本不认识的文件不被当成写坏的删掉", async () => {
        const dir = join(book.library, "temp-left");
        await mkdir(dir, {recursive: true});
        await writeFile(join(dir, "book.json"), JSON.stringify({generation: "g"}));
        await writeOverlay(dir, "g", current => ({items: current.items, result: 0}));
        expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
        const unknown = JSON.stringify({format: 2, generation: "g", version: 2, items: []});
        await writeFile(join(dir, "revisions-2.json"), unknown);
        const error = await writeOverlay(dir, "g", current => ({items: current.items, result: 0})).catch((caught: unknown) => caught);
        expect((error as StoryError).code).toBe("unsupported_format");
        expect(await readFile(join(dir, "revisions-2.json"), "utf8")).toBe(unknown);
    });
});
