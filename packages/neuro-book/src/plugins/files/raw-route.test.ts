/**
 * 按地址读取字节（docs/specs/workspace/files.md 的“按地址读取字节”，验收 10）：真实登记表、真实身份文件与真实目录，
 * 路由经 Hono 应用的 `fetch` 调用（`nbook.http` 的分发器也是这样交给它的）。项目的运行状态由测试给出：路由只读
 * `list()` 里的状态与代次，起项目子进程不改变这里要验的东西。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, stat, symlink, truncate, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {readProjectIdentity} from "nbook/server/projects/identity";
import {createProjectRegistry} from "nbook/server/projects/registry";
import type {ProjectMetadataRead, ProjectRunState, ProjectsService} from "nbook/shared/projects";

import {createPreviewTokens, createRawRoutes, RAW_MAX_BYTES} from "./backend/raw-route";
import {openRoot} from "./backend/rooted";

let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "raw-route");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

/** 一部登记好的作品 `Book`（第 3 代在运行）与一个用户资产根。 */
async function world() {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const book = join(root, "Book");
    const user = join(root, "user");
    await mkdir(join(book, "images"), {recursive: true});
    await mkdir(user, {recursive: true});
    await writeFile(join(book, "images", "a.png"), PNG);
    await writeFile(join(book, "page.html"), "<p>hi</p>");
    await writeFile(join(root, "outside.txt"), "secret");
    await writeFile(join(user, "note.txt"), "user note");
    const registry = createProjectRegistry({stateRoot: join(root, "state"), cwd: root});
    const registered = await registry.register(book);
    if (!registered.ok) throw new Error(registered.detail);
    const id = registered.project.id;
    const run = {state: "running" as ProjectRunState, generation: 3 as number | null};
    const projects: Pick<ProjectsService, "list" | "readMetadata"> = {
        list: async () => {
            const listed = await registry.list();
            return listed.ok ? {ok: true, value: listed.value.map((record) => ({...record, ...run, pid: null}))} : listed;
        },
        // 与项目管理器同一判据：身份文件里的 id 要等于登记的 id。
        readMetadata: async (wanted): Promise<ProjectMetadataRead> => {
            const listed = await registry.list();
            const path = listed.ok ? listed.value.find((record) => record.id === wanted)?.path : undefined;
            if (path === undefined) return {ok: false, reason: "unknown-project", detail: wanted};
            const identity = await readProjectIdentity(path);
            if (identity.status !== "found") return {ok: false, reason: "identity-invalid", detail: identity.status};
            return identity.id === wanted ? {ok: true, metadata: identity.metadata, problems: identity.problems} : {ok: false, reason: "identity-conflict", detail: identity.id};
        },
    };
    const userRoot = await openRoot(user, {controlDirectory: false, lockDirectory: join(root, "locks"), report: () => undefined});
    if ("ok" in userRoot) throw new Error(userRoot.detail);
    const tokens = createPreviewTokens();
    const app = createRawRoutes({projects, user: userRoot, tokens, record: () => undefined});
    const get = (path: string, headers: Record<string, string> = {}, method = "GET") => app.fetch(new Request(`http://127.0.0.1${path}`, {headers, method}), {registerEventStream: () => undefined});
    return {root, book, id, run, get, tokens};
}

describe("workspace.files 按地址读取字节", () => {
    it("读运行中项目的文件：原始字节、按扩展名的类型、nosniff 与 sandbox；ETag 命中为 304", async () => {
        const {id, get} = await world();
        const response = await get(`/raw/project/${id}/3/images/a.png`);
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-security-policy")).toBe("sandbox");
        const etag = response.headers.get("etag");
        expect(etag).not.toBeNull();
        const again = await get(`/raw/project/${id}/3/images/a.png`, {"If-None-Match": etag!});
        expect(again.status).toBe(304);
        expect(again.headers.get("etag")).toBe(etag);
        // HEAD 给出同样的头与大小，不带正文。
        const head = await get(`/raw/project/${id}/3/images/a.png`, {}, "HEAD");
        expect([head.status, head.headers.get("etag"), head.headers.get("content-length"), head.headers.get("content-type")]).toEqual([200, etag, String(PNG.length), "image/png"]);
        expect((await head.arrayBuffer()).byteLength).toBe(0);
        expect((await get(`/raw/project/${id}/3/page.html`)).headers.get("content-type")).toBe("text/html; charset=utf-8");
    });

    it("同样大小的改写、并把修改时间改回原值：ETag 仍然变，不会 304 出旧字节", async () => {
        const {book, id, get} = await world();
        const file = join(book, "images", "a.png");
        const before = await stat(file);
        const first = await get(`/raw/project/${id}/3/images/a.png`);
        const etag = first.headers.get("etag")!;
        const changed = PNG.map((byte, at) => (at === PNG.length - 1 ? byte ^ 1 : byte));
        await writeFile(file, changed);
        await utimes(file, before.atime, before.mtime);
        const again = await get(`/raw/project/${id}/3/images/a.png`, {"If-None-Match": etag});
        expect(again.status).toBe(200);
        expect(new Uint8Array(await again.arrayBuffer())).toEqual(changed);
    });

    it("路径各段按 URL 编码", async () => {
        const {book, id, get} = await world();
        await writeFile(join(book, "images", "第 1 章.png"), PNG);
        const response = await get(`/raw/project/${id}/3/images/${encodeURIComponent("第 1 章.png")}`);
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    });

    it("只服务正在运行的那一代：代次不符、项目停了都是 410", async () => {
        const {id, run, get} = await world();
        expect((await get(`/raw/project/${id}/2/images/a.png`)).status).toBe(410);
        run.state = "stopped";
        run.generation = null;
        const stopped = await get(`/raw/project/${id}/3/images/a.png`);
        expect(stopped.status).toBe(410);
        expect(await stopped.json()).toMatchObject({error: {code: "generation-gone"}});
        run.state = "running";
        run.generation = 4;
        expect((await get(`/raw/project/${id}/4/images/a.png`)).status).toBe(200);
    });

    it("登记路径上的身份文件不是这部作品：409，不交出别的作品的文件", async () => {
        const {book, id, run, get} = await world();
        const identity = join(book, ".nbook", "project.json");
        const original = await Bun.file(identity).json() as Record<string, unknown>;
        await writeFile(identity, JSON.stringify({...original, id: "00000000-0000-4000-8000-000000000000"}));
        run.generation = 5;
        const response = await get(`/raw/project/${id}/5/images/a.png`);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({error: {code: "identity-conflict"}});
    });

    it("控制目录、目录、不存在、根外的链接一律 404，不区分受保护与不存在", async () => {
        const {root, book, id, get} = await world();
        await symlink(join(root, "outside.txt"), join(book, "leak.txt"));
        for (const path of [".nbook/project.json", "images", "missing.png", "leak.txt", ""]) {
            const response = await get(`/raw/project/${id}/3/${path}`);
            expect(response.status).toBe(404);
            expect(await response.json()).toMatchObject({error: {code: "not-found"}});
        }
    });

    it("超过上限为 413，不读内容", async () => {
        const {book, id, get} = await world();
        const big = join(book, "big.bin");
        await writeFile(big, "");
        await truncate(big, RAW_MAX_BYTES + 1);
        const response = await get(`/raw/project/${id}/3/big.bin`);
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({error: {code: "too-large"}});
    });

    it("别的网页发来的请求是 403；本源、用户自己打开与本机进程照常", async () => {
        const {id, get} = await world();
        for (const site of ["cross-site", "same-site"]) {
            const response = await get(`/raw/project/${id}/3/images/a.png`, {"Sec-Fetch-Site": site});
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({error: {code: "cross-site"}});
        }
        const allowed: Array<Record<string, string>> = [{"Sec-Fetch-Site": "same-origin"}, {"Sec-Fetch-Site": "none"}, {}];
        for (const headers of allowed) expect((await get(`/raw/project/${id}/3/images/a.png`, headers)).status).toBe(200);
        expect((await get("/raw/user/note.txt", {"Sec-Fetch-Site": "cross-site"})).status).toBe(403);
    });

    it("user:// 的文件按同样的规则给出", async () => {
        const {get} = await world();
        const response = await get("/raw/user/note.txt");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("user note");
        expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect((await get("/raw/user/missing.txt")).status).toBe(404);
    });
});

describe("workspace.files 预览的受限读取", () => {
    it("令牌放行这部作品：带 Origin: null 读到响应与 CORS 头、no-referrer；不看 Sec-Fetch-Site；响应头自带沙箱与令牌的网络限制", async () => {
        const {id, get, tokens} = await world();
        const token = tokens.issue(id, 3, false);
        const response = await get(`/preview/${token}/images/a.png`, {"Origin": "null", "Sec-Fetch-Site": "cross-site"});
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
        expect(response.headers.get("access-control-allow-origin")).toBe("null");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        // 页面在 iframe 里导航到作品里别的 HTML 时加载的是这份响应：不靠注入的 meta，响应头自己带沙箱与网络限制。
        const policy = response.headers.get("content-security-policy") ?? "";
        expect(policy).toStartWith("sandbox allow-scripts; default-src 'none'");
        expect(policy).toContain(`connect-src http://127.0.0.1/api/nbook.files/preview/${token}/ data: blob:`);
        const online = tokens.issue(id, 3, true);
        expect((await get(`/preview/${online}/images/a.png`)).headers.get("content-security-policy")).toStartWith("sandbox allow-scripts; default-src *");
        // 别的来源拿不到 CORS 头：浏览器里读不到响应。
        expect((await get(`/preview/${token}/images/a.png`, {"Origin": "http://evil.example"})).headers.get("access-control-allow-origin")).toBeNull();
    });

    it("令牌无效、作废、这一代结束都是 404；控制目录照样读不到", async () => {
        const {id, run, get, tokens} = await world();
        expect((await get("/preview/0123456789abcdef0123456789abcdef/images/a.png")).status).toBe(404);
        const token = tokens.issue(id, 3, false);
        expect((await get(`/preview/${token}/.nbook/project.json`)).status).toBe(404);
        tokens.revoke(token);
        expect((await get(`/preview/${token}/images/a.png`)).status).toBe(404);
        const second = tokens.issue(id, 3, false);
        run.generation = 4;
        expect((await get(`/preview/${second}/images/a.png`)).status).toBe(404);
        // 代次结束后令牌已作废：这一代回来（测试里改回）也不再放行。
        run.generation = 3;
        expect((await get(`/preview/${second}/images/a.png`)).status).toBe(404);
        expect(tokens.lookup(second)).toBeNull();
    });
});
