/**
 * 独立服务：登录与会话、RPC 与失败码、两种调用形式一致、单实例与登记（docs/specs/story/queries.md 验收 8、11 的
 * HTTP 部分与 F12；docs/specs/story/cli-skill.md 输出 4、5、F3、验收 4）。全部用真的 `serve` 子进程。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

import type {StoryMethod} from "../contract/contract";
import {openTestBook, type TestBook} from "../../testing/api";
import {loginCookie, rpc, runCli, startServe, type ServeProcess} from "../../testing/processes";

let book: TestBook;
const running: ServeProcess[] = [];

beforeAll(async () => {
    book = await openTestBook("server");
});

afterEach(async () => {
    for (const serve of running.splice(0)) await serve.stop("SIGKILL");
});

afterAll(async () => {
    await book.close();
});

async function serve(): Promise<ServeProcess> {
    const process = await startServe(book.library);
    running.push(process);
    return process;
}

describe("登录与会话（F12）", () => {
    test("没有会话时 RPC 报 unauthorized、页面是 401；每个响应都带实例号", async () => {
        const server = await serve();
        const call = await rpc(server.base!, "books.list", {});
        expect(call.status).toBe(401);
        expect(call.body).toEqual(expect.objectContaining({code: "unauthorized"}));
        expect(call.instance).toBeTruthy();
        const page = await fetch(`${server.base}/book/fox/overview`);
        expect(page.status).toBe(401);
        expect(page.headers.get("x-nbstory-instance")).toBe(call.instance);
    });

    test("口令不对返回 401；同一个登录链接可以反复登录（换浏览器也能）", async () => {
        const server = await serve();
        const wrong = await fetch(`${server.base}/login?token=nope`, {redirect: "manual"});
        expect(wrong.status).toBe(401);
        const first = await loginCookie(server.login!);
        const second = await loginCookie(server.login!);
        expect(first).not.toBe(second);
        for (const cookie of [first, second]) expect((await rpc(server.base!, "books.list", {}, cookie)).status).toBe(200);
    });

    test("服务重启后旧会话失效，新链接可用", async () => {
        const first = await serve();
        const cookie = await loginCookie(first.login!);
        expect(await first.stop()).toBe(0);
        const second = await serve();
        expect((await rpc(second.base!, "books.list", {}, cookie)).status).toBe(401);
        expect((await rpc(second.base!, "books.list", {}, await loginCookie(second.login!))).status).toBe(200);
    });
});

describe("RPC（验收 8）", () => {
    test("同一参数下进程内调用与 POST /api/rpc 的结果逐字段相同", async () => {
        const server = await serve();
        const cookie = await loginCookie(server.login!);
        const calls: [StoryMethod, Record<string, unknown>][] = [
            ["book.info", {at: {chapter: 38, paragraph: 57}}],
            ["entity.card", {at: {chapter: 38}, entity: "狐狐"}],
            ["secrets.matrix", {at: {chapter: 38}}],
            ["entity.knowledge", {at: {chapter: 100}, entity: "e1-1", limit: 20}],
            ["graph.relations", {at: {chapter: 38}, perspective: "e1-1"}],
            ["source.read", {at: {chapter: 38, paragraph: 57}, from: {chapter: 38, paragraph: 50}, to: {chapter: 38, paragraph: 62}}],
            ["ledger.track", {at: {chapter: 38}, track: "神典石"}],
        ];
        for (const [method, params] of calls) {
            const local = await book.api.call(method, params);
            const remote = await rpc(server.base!, method, params, cookie);
            expect(local.ok).toBe(true);
            expect(remote.status).toBe(200);
            expect(remote.body).toEqual(local.ok ? local.value : null);
        }
    });

    test("失败按失败码给 HTTP 状态码；entity_ambiguous 带候选", async () => {
        const server = await serve();
        const cookie = await loginCookie(server.login!);
        const ambiguous = await rpc(server.base!, "entity.card", {at: {chapter: 38}, entity: "小破书"}, cookie);
        expect(ambiguous.status).toBe(409);
        expect((ambiguous.body as {candidates: unknown[]}).candidates).toHaveLength(2);
        expect((await rpc(server.base!, "source.read", {at: {chapter: 38, paragraph: 57}, from: {chapter: 39}}, cookie)).status).toBe(403);
        expect((await rpc(server.base!, "book.info", {book: "nope"}, cookie)).status).toBe(404);
        expect((await rpc(server.base!, "book.info", "{not json", cookie)).status).toBe(400);
        expect((await rpc(server.base!, "no.such", {}, cookie)).status).toBe(400);
    });
});

describe("单实例与登记（cli-skill 验收 4、F3）", () => {
    test("同一书库再次 serve 退出码 3 并给出已有服务的地址；第一个停止后再启动成功", async () => {
        const first = await serve();
        const second = await serve();
        expect(second.login).toBeNull();
        expect(await second.exited).toBe(3);
        expect(second.stderr()).toContain(first.base!);
        expect(await first.stop()).toBe(0);
        expect(existsSync(join(book.library, ".serve.json"))).toBe(false);
        const third = await serve();
        expect(third.login).not.toBeNull();
    });

    test("服务被强行结束（不撤销登记）后再启动也成功", async () => {
        const first = await serve();
        await first.stop("SIGKILL");
        expect(existsSync(join(book.library, ".serve.json"))).toBe(true);
        const second = await serve();
        expect(second.login).not.toBeNull();
        const registration = JSON.parse(await readFile(join(book.library, ".serve.json"), "utf8")) as {url: string};
        expect(registration.url).toBe(second.base!);
    });

    test("两个 serve 同时启动恰有一个成功", async () => {
        const [a, b] = await Promise.all([serve(), serve()]);
        const started = [a, b].filter(item => item.login !== null);
        expect(started).toHaveLength(1);
        const failed = [a, b].find(item => item.login === null)!;
        expect(await failed.exited).toBe(3);
    });
});

describe("命令行的查看器地址（cli-skill 输出 4）", () => {
    test("有有效登记时给人读的输出末尾附地址，不含口令；登记失效后不附", async () => {
        const server = await serve();
        const live = await runCli(["card", "苏天晴", "--at", "38", "--library", book.library]);
        expect(live.code).toBe(0);
        const url = /查看器：(\S+)$/u.exec(live.stdout.trim())?.[1] ?? null;
        expect(url).toBe(`${server.base}/book/fox/roster?at=38&entity=e1-1&tab=summary`);
        expect(live.stdout).not.toContain("token");
        await server.stop("SIGKILL");
        const stale = await runCli(["card", "苏天晴", "--at", "38", "--library", book.library]);
        expect(stale.stdout).not.toContain("查看器：");
    });
});
