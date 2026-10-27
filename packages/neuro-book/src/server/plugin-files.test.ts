/**
 * 插件文件端点（docs/specs/runtime/plugin-code-loading.md 输出 8、验收 8）：经同进程启动的真实后端请求。插件经真实的
 * 安装与启动准备装进状态根，地址带启动时算出的内容摘要。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {chmod, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {request as httpRequest} from "node:http";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {installedPlugins, NO_INSTALLED_PLUGINS, prepareInstalledPlugins} from "nbook/plugin-platform/backend/startup";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import {pluginFilesPrefix} from "nbook/plugin-platform/shared/plugin-files";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {createPluginFilesRoute} from "./plugin-files";
import {startClaimedServer} from "./testing/claimed-server";
import type {RunningServer} from "./start";

let tmp = "";
let server: RunningServer;
let prepared: PluginsPreparation;
let prefix = "";

/** 一个带浏览器入口与样式的插件文件夹。 */
async function source(name: string, code: string): Promise<string> {
    const directory = join(tmp, "sources", name);
    await mkdir(join(directory, "assets/icons"), {recursive: true});
    await writeFile(join(directory, "package.json"), JSON.stringify({
        publisher: "example",
        name: "files",
        version: "1.0.0",
        engines: {neurobook: ">=0.1.0"},
        entries: {browser: {location: "browser", main: "browser.js"}},
        style: "style.css",
    }));
    await writeFile(join(directory, "browser.js"), code);
    await writeFile(join(directory, "style.css"), ".x { color: red; }");
    await writeFile(join(directory, "assets/icons/a.svg"), "<svg/>");
    return directory;
}

function inventory(startup = NO_INSTALLED_PLUGINS) {
    return createPluginInventory({root: join(tmp, "state", "plugins"), profile: NEUROBOOK_PROFILE, builtin: [], startup, record: () => undefined});
}

/** 原样发出路径（`fetch` 会先规范化掉 `..`）。 */
function rawGet(path: string): Promise<{readonly status: number; readonly body: string}> {
    const url = new URL(server.url!);
    return new Promise((resolve, reject) => {
        const request = httpRequest({host: url.hostname, port: url.port, path, method: "GET"}, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (body += chunk));
            response.on("end", () => resolve({status: response.statusCode ?? 0, body}));
        });
        request.on("error", reject);
        request.end();
    });
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-files", "plugin-files");
    const installed = await inventory().install(await source("v1", "console.log('v1');"));
    if (!installed.ok) throw new Error(JSON.stringify(installed));
    prepared = await prepareInstalledPlugins({root: join(tmp, "state", "plugins"), profile: NEUROBOOK_PROFILE, safeMode: false});
    const [plugin] = installedPlugins(prepared.startup);
    if (plugin === undefined) throw new Error("插件没有登记");
    prefix = pluginFilesPrefix(NEUROBOOK_PROFILE.filesMount, plugin.id, plugin.digest);
    server = await startClaimedServer({
        config: {host: "127.0.0.1", port: 0, stateRoot: join(tmp, "state"), logDirectory: join(tmp, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        prepared,
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    await server.ready;
});

afterAll(async () => {
    server.requestStop("test:done");
    await server.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("插件文件端点", () => {
    it("返回版本目录里的文件：内容类型按扩展名，长期缓存，带 CORP 与 nosniff", async () => {
        const response = await fetch(new URL(`${prefix}browser.js`, server.url!));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("javascript");
        expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toBe("console.log('v1');");
        const nested = await fetch(new URL(`${prefix}assets/icons/a.svg`, server.url!));
        expect([nested.status, nested.headers.get("content-type")]).toEqual([200, "image/svg+xml"]);
    });

    it("编码的分隔符与 NUL 带进来的越界路径返回 400；明文的 .. 拿不到版本目录外的文件", async () => {
        for (const path of ["..%2F..%2Fplugins.json", "assets%2F..%2F..%2F..%2Fplugins.json", "..%5C..%5Cplugins.json", "browser.js%00", "%2E%2E%2Fplugins.json"]) {
            const response = await rawGet(`${prefix}${path}`);
            expect([path, response.status]).toEqual([path, 400]);
        }
        const plain = await rawGet(`${prefix}../../../../plugins.json`);
        expect(plain.status).not.toBe(200);
        expect(plain.body).not.toContain("nbook.plugins/v1");
    });

    it("摘要不是当前的、插件没有登记、文件不存在或是目录、经过符号链接：404，不缓存", async () => {
        const [plugin] = installedPlugins(prepared.startup);
        await symlink(join(tmp, "state", "plugins", "plugins.json"), join(plugin!.root, "linked.json"));
        try {
            for (const url of [
                pluginFilesPrefix(NEUROBOOK_PROFILE.filesMount, "example.files", "0000000000000000") + "browser.js",
                pluginFilesPrefix(NEUROBOOK_PROFILE.filesMount, "example.other", plugin!.digest) + "browser.js",
                `${prefix}missing.js`,
                `${prefix}assets`,
                `${prefix}linked.json`,
            ]) {
                const response = await fetch(new URL(url, server.url!));
                expect([url, response.status, response.headers.get("cache-control")]).toEqual([url, 404, "no-store"]);
            }
        } finally {
            await rm(join(plugin!.root, "linked.json"));
        }
    });

    it("读文件因路径以外的原因失败（权限）：500 并记一条诊断，不当作不存在", async () => {
        const [plugin] = installedPlugins(prepared.startup);
        const records: DiagnosticInput[] = [];
        const route = createPluginFilesRoute(installedPlugins(prepared.startup), (input) => records.push(input));
        await mkdir(join(plugin!.root, "locked"));
        await chmod(join(plugin!.root, "locked"), 0o000);
        try {
            const response = await route.handle(new Request(new URL(`${prefix.slice("/api/runtime".length)}locked/x.js`, "http://127.0.0.1").href));
            expect(response.status).toBe(500);
            expect(records).toEqual([expect.objectContaining({event: "plugins.files.read-failed", data: {plugin: "example.files", path: "locked/x.js"}})]);
        } finally {
            await chmod(join(plugin!.root, "locked"), 0o755);
            await rm(join(plugin!.root, "locked"), {recursive: true});
        }
    });

    it("运行中卸载后服务端照旧送出原内容；重启完成卸载、重装同一版本的新内容：内容摘要变了，旧地址 404，新地址是新内容", async () => {
        const [before] = installedPlugins(prepared.startup);
        const root = join(tmp, "state", "plugins");
        expect(await inventory(prepared.startup).uninstall("example.files")).toMatchObject({ok: true});
        // 卸载在下一次启动才生效：运行中的服务端照旧从原目录送出原内容。
        const running = await fetch(new URL(`${prefix}browser.js`, server.url!));
        expect([running.status, await running.text()]).toEqual([200, "console.log('v1');"]);

        // 重启：服务端停下之后，下一次启动完成卸载，再装同一版本的新内容，再下一次启动登记它。
        server.requestStop("test:restart");
        await server.stopped;
        const afterUninstall = await prepareInstalledPlugins({root, profile: NEUROBOOK_PROFILE, safeMode: false});
        expect(await inventory(afterUninstall.startup).install(await source("v1-again", "console.log('again');"))).toMatchObject({ok: true});
        const again = await prepareInstalledPlugins({root, profile: NEUROBOOK_PROFILE, safeMode: false});
        const [after] = installedPlugins(again.startup);
        expect(after!.version).toBe(before!.version);
        expect(after!.digest).not.toBe(before!.digest);
        const route = createPluginFilesRoute(installedPlugins(again.startup), () => undefined);
        // 直接调宿主路由时给的是分发器转交的形式：已去掉挂载前缀 `/api/runtime`。
        const at = (digest: string) => route.handle(new Request(new URL(`${pluginFilesPrefix(NEUROBOOK_PROFILE.filesMount, "example.files", digest).slice(NEUROBOOK_PROFILE.filesMount.length)}browser.js`, "http://127.0.0.1").href));
        expect((await at(before!.digest)).status).toBe(404);
        const fresh = await at(after!.digest);
        expect([fresh.status, await fresh.text()]).toEqual([200, "console.log('again');"]);
        expect(await readFile(join(after!.root, "browser.js"), "utf8")).toBe("console.log('again');");
    });
});
