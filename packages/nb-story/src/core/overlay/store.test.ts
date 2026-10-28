/**
 * 修订文件的跨进程写入（docs/specs/story/revisions.md 的“时序与寿命”与验收 8）：用真实子进程并发写，用最后落盘的文件核对。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir} from "node:fs/promises";
import {join} from "node:path";

import {openTestBook, type TestBook} from "../../../testing/api";

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
