/**
 * 引导接口：经同进程启动的真实后端（真实监听与准入）取得，按产品清单列出有浏览器入口的插件。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {Value} from "typebox/value";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {pluginsAt, productPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema} from "nbook/shared/browser-bootstrap";

import {browserBootstrap} from "./browser-bootstrap";
import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {startClaimedServer} from "./testing/claimed-server";
import type {RunningServer} from "./start";

let tmp = "";
/** 作品目录不能放在状态根里（登记会拒绝），另开一个根。 */
let books = "";
let server: RunningServer;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-bootstrap", "browser-bootstrap");
    books = await createTestTmpRoot("neuro-book-bootstrap", "books");
    server = await startClaimedServer({
        config: {host: "127.0.0.1", port: 0, stateRoot: tmp, logDirectory: join(tmp, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    await server.ready;
});

afterAll(async () => {
    server.requestStop("test:done");
    await server.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    if (books !== "") await rm(books, {recursive: true, force: true});
});

describe("浏览器引导接口", () => {
    it("返回协议版本、修订号、清单里有浏览器入口的插件与 RPC 端口；不缓存，不带服务端路径", async () => {
        const response = await fetch(new URL(BROWSER_BOOTSTRAP_PATH, server.url!));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const text = await response.text();
        expect(text).not.toContain(tmp);
        const body: unknown = JSON.parse(text);
        expect(Value.Check(BrowserBootstrapSchema, body)).toBe(true);
        const expected = pluginsAt("browser", productPlugins).map(({id, version}) => ({id, version}));
        expect(body).toMatchObject({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: {port: Number(new URL(server.rpcUrl).port), path: "/"}});
        expect((body as {plugins: unknown[]}).plugins).toEqual(expect.arrayContaining(expected));
        expect((body as {plugins: unknown[]}).plugins).toHaveLength(expected.length);
    });

    it("请求带 project 时附上作品的显示名：没写书名用目录原名，写了书名用书名；没有登记、没带参数时不带", async () => {
        const directory = join(books, "雾港");
        await mkdir(directory, {recursive: true});
        const registered = await server.projects.registry.register(directory);
        if (!registered.ok) throw new Error(registered.detail);
        const {id, name} = registered.project;
        const projectOf = async (project: string | null): Promise<unknown> => {
            const url = new URL(BROWSER_BOOTSTRAP_PATH, server.url!);
            if (project !== null) url.searchParams.set("project", project);
            const body = (await (await fetch(url)).json()) as {project?: unknown};
            expect(Value.Check(BrowserBootstrapSchema, body)).toBe(true);
            return body.project;
        };

        // 中文目录名的短名是 `project`：界面上不该出现它。
        expect(name).toBe("project");
        expect(await projectOf(name)).toEqual({title: "雾港"});
        const updated = await server.projects.updateMetadata(id, {title: "雾港纪事"});
        expect(updated.ok).toBe(true);
        expect(await projectOf(id)).toEqual({title: "雾港纪事"});
        expect(await projectOf("没有这部")).toBeUndefined();
        expect(await projectOf(null)).toBeUndefined();
    });

    it("修订号只随有浏览器入口的插件集合与版本变化，与清单顺序无关", () => {
        const a: PluginDescriptor = {id: "a", version: "1.0.0", locations: ["browser"]};
        const b: PluginDescriptor = {id: "b", version: "1.0.0", locations: ["server", "browser"]};
        const serverOnly: PluginDescriptor = {id: "s", version: "1.0.0", locations: ["server"]};
        const rpc = {port: 4100, path: "/"};
        const revision = browserBootstrap([a, b, serverOnly], [], rpc).revision;
        expect(browserBootstrap([serverOnly, b, a], [], rpc).revision).toBe(revision);
        expect(browserBootstrap([a, b], [], {port: 4200, path: "/"}).revision).toBe(revision);
        expect(browserBootstrap([{...a, version: "1.0.1"}, b], [], rpc).revision).not.toBe(revision);
        expect(browserBootstrap([a], [], rpc).revision).not.toBe(revision);
    });

    it("只有顶层声明式贡献的插件也列出（浏览器要登记它的声明），只有服务端入口、没有声明的不列；声明的插件版本变化改变修订号", () => {
        const browser: PluginDescriptor = {id: "a", version: "1.0.0", locations: ["browser"]};
        const declared: PluginDescriptor = {id: "d", version: "1.0.0", locations: ["server"], contributions: [{capability: "settings.properties", id: "d/x", declaration: {}}]};
        const serverOnly: PluginDescriptor = {id: "s", version: "1.0.0", locations: ["server"]};
        const rpc = {port: 4100, path: "/"};
        const body = browserBootstrap([serverOnly, declared, browser], [], rpc);
        expect(body.plugins).toEqual([{id: "a", version: "1.0.0"}, {id: "d", version: "1.0.0"}]);
        expect(browserBootstrap([serverOnly, {...declared, version: "1.0.1"}, browser], [], rpc).revision).not.toBe(body.revision);
    });

    it("内置插件只给 id 与版本；第三方插件另带清单（入口只留浏览器的）与文件 URL 前缀，修订号随版本与内容摘要变化（browser-host 输出 2）", () => {
        const builtin: PluginDescriptor = {id: "nbook.a", version: "0.1.0", locations: ["browser"]};
        const raw = {
            publisher: "example",
            name: "d",
            version: "1.0.0",
            engines: {neurobook: ">=0.1.0"},
            entries: {server: {location: "server", main: "server.js"}, browser: {location: "browser", main: "browser.js"}},
            contributes: [{capability: "settings.properties", id: "example.d/x", declaration: {}}],
            style: "style.css",
        };
        const installed = {id: "example.d", version: "1.0.0", root: "/state/plugins/example.d/1.0.0", digest: "0123456789abcdef", manifest: raw};
        const rpc = {port: 4100, path: "/"};
        const body = browserBootstrap([builtin], [installed], rpc);
        expect(body.plugins).toEqual([
            {id: "example.d", version: "1.0.0", manifest: {...raw, entries: {browser: {location: "browser", main: "browser.js"}}}, files: "/api/runtime/plugins/example.d/files/0123456789abcdef/"},
            {id: "nbook.a", version: "0.1.0"},
        ]);
        expect(JSON.stringify(body)).not.toContain("/state/plugins");
        expect(browserBootstrap([builtin], [{...installed, version: "1.0.1", manifest: {...raw, version: "1.0.1"}}], rpc).revision).not.toBe(body.revision);
        expect(browserBootstrap([builtin], [{...installed, digest: "fedcba9876543210"}], rpc).revision).not.toBe(body.revision);
    });

    it("目录索引列出全部写了 l10n 的第三方插件，包括不在浏览器登记的；只有后端入口的插件的目录变化也改变修订号", () => {
        const builtin: PluginDescriptor = {id: "nbook.a", version: "0.1.0", locations: ["browser"]};
        const raw = {publisher: "example", name: "worker", version: "1.0.0", engines: {neurobook: ">=0.1.0"}, entries: {server: {location: "server", main: "server.js"}}, l10n: {source: "en-US", locales: ["en-US", "zh-CN"]}};
        const worker = {id: "example.worker", version: "1.0.0", root: "/state/plugins/example.worker/1.0.0", digest: "0123456789abcdef", manifest: raw};
        const plain = {id: "example.plain", version: "1.0.0", root: "/state/plugins/example.plain/1.0.0", digest: "1111111111111111", manifest: {publisher: "example", name: "plain", version: "1.0.0", engines: {neurobook: ">=0.1.0"}}};
        const rpc = {port: 4100, path: "/"};
        const body = browserBootstrap([builtin], [worker, plain], rpc);
        expect(Value.Check(BrowserBootstrapSchema, body)).toBe(true);
        expect(body.plugins).toEqual([{id: "nbook.a", version: "0.1.0"}]);
        expect(body.catalogs).toEqual([{plugin: "example.worker", source: "en-US", locales: ["en-US", "zh-CN"], digest: "0123456789abcdef", prefix: "/api/runtime/plugins/example.worker/catalogs/0123456789abcdef/"}]);
        expect(browserBootstrap([builtin], [plain, worker], rpc).revision).toBe(body.revision);
        expect(browserBootstrap([builtin], [{...worker, digest: "fedcba9876543210"}, plain], rpc).revision).not.toBe(body.revision);
        expect(browserBootstrap([builtin], [{...worker, manifest: {...raw, l10n: {source: "en-US", locales: ["en-US"]}}}, plain], rpc).revision).not.toBe(body.revision);
        expect(browserBootstrap([builtin], [plain], rpc).revision).not.toBe(body.revision);
    });
});
