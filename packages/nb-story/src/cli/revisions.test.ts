/**
 * `nbstory revisions`（docs/specs/story/revisions.md 输出 13）：子进程跑真实命令，--json 的 data 与进程内调用的结果相同；
 * 用法错误退出码 2，业务失败退出码 1。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {openTestBook, type TestBook} from "../../testing/api";
import {runCli} from "../../testing/processes";

let book: TestBook;
beforeAll(async () => {
    book = await openTestBook("cli-revisions");
});
afterAll(async () => {
    await book.close();
});

const cli = (args: string[]) => runCli([...args, "--library", book.library]);

describe("列表与确认", () => {
    test("list 与进程内调用一致；确认后 list 里是已采纳，undo 后回到待确认；文字输出写出状态与一句话", async () => {
        const json = await cli(["revisions", "list", "--at", "30.61", "--json"]);
        expect(json.code).toBe(0);
        const local = await book.api.call("revisions.list", {at: {chapter: 30, paragraph: 61}});
        expect(JSON.parse(json.stdout)).toEqual({ok: true, data: local.ok ? local.value : null});

        const confirmed = await cli(["revisions", "confirm", "s30-13"]);
        expect(confirmed.code).toBe(0);
        expect(confirmed.stdout).toContain("已采纳");
        const text = await cli(["revisions", "list", "--at", "30.61", "--state", "adopted"]);
        expect(text.stdout).toMatch(/r1\s+已采纳\s+抽取候选/u);
        const undone = await cli(["revisions", "undo", "r1", "--json"]);
        expect(JSON.parse(undone.stdout).data.revision).toMatchObject({id: "st:s30-13", state: "pending"});
        expect((await cli(["info", "--at", "30.61"])).stdout).toContain("待确认的修订：1 条");
    });

    test("link、kind、move-name 带依据位置；依据缺了或写得不对是用法错误（2），目标不对是业务失败（1）", async () => {
        const link = await cli(["revisions", "link", "e3-2", "e1-1", "--evidence", "10.1", "--certainty", "certain", "--json"]);
        expect(link.code).toBe(0);
        expect(JSON.parse(link.stdout).data.revision).toMatchObject({op: "identity.link", state: "adopted"});
        expect((await cli(["revisions", "kind", "e3-2", "person", "--evidence", "3.20", "--json"])).code).toBe(0);
        expect((await cli(["revisions", "move-name", "狐狐", "e1-1", "e3-2", "--evidence", "30.1", "--json"])).code).toBe(0);
        expect((await cli(["revisions", "link", "e3-2", "e1-1"])).code).toBe(2);
        expect((await cli(["revisions", "link", "e3-2", "e1-1", "--evidence", "十"])).code).toBe(2);
        expect((await cli(["revisions", "frobnicate"])).code).toBe(2);
        const missing = await cli(["revisions", "link", "e3-2", "e1-1", "--evidence", "999.1"]);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain("evidence_invalid");
        const bad = await cli(["revisions", "confirm", "s8-11"]);
        expect(bad.code).toBe(1);
        expect(bad.stderr).toContain("revision_not_candidate");
    });

    test("evidence 可按称呼筛；写入的命令带 --at 是用法错误（不悄悄丢掉）", async () => {
        const run = await cli(["revisions", "evidence", "e1-1", "--text", "狐狐", "--at", "10", "--json"]);
        expect(run.code).toBe(0);
        const items = JSON.parse(run.stdout).data.items as {names: string[]}[];
        expect(items.length).toBeGreaterThan(0);
        expect(items.every(item => item.names.includes("狐狐"))).toBe(true);
        expect((await cli(["revisions", "confirm", "s30-13", "--at", "30.61"])).code).toBe(2);
        expect((await cli(["revisions", "undo", "r1", "--at", "30.61"])).code).toBe(2);
    });

    test("evidence 列出对象出现的段", async () => {
        const run = await cli(["revisions", "evidence", "e3-2", "--at", "10", "--json"]);
        expect(run.code).toBe(0);
        expect(JSON.parse(run.stdout).data.items.length).toBeGreaterThan(0);
    });
});
