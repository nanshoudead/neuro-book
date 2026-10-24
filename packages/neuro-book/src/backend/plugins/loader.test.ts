/**
 * 服务端入口代码的装载（docs/specs/runtime/plugin-code-loading.md 输出 1、3、4，验收 6）：真实的内核与装载器，插件是安装目录
 * 里手写的 ESM 文件。再激活得到新的模块实例、SDK 是宿主那一份、装载失败只影响这个入口并带上原因、模块顶层挂起不挡启动。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {Application, HostContext} from "@notnotype/nb-runtime/application";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import * as hostSdk from "nbook/sdk/index";

import type {InstalledPlugin} from "./installed";
import {thirdPartyDefinitionsAt} from "./loader";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-loader", "loader");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Probe {
    readonly calls: Array<{readonly count: number; readonly sdk: unknown}>;
    gate: Promise<void>;
    /** 模块顶层求值的次数与是否放行（顶层按它抛错）。 */
    evaluations: number;
    ready: boolean;
}

/** 插件代码经全局对象把它看到的东西交回测试（插件代码不能 import 测试模块）。 */
const probe: Probe = {calls: [], gate: Promise.resolve(), evaluations: 0, ready: false};
(globalThis as unknown as {__nbookLoaderProbe: Probe}).__nbookLoaderProbe = probe;

/** 一个已安装的插件：`files` 是相对版本目录的路径到内容；每个入口都在服务端、启动即激活。`base` 是插件根目录，缺省临时根。 */
async function installed(name: string, entries: Readonly<Record<string, string>>, files: Readonly<Record<string, string>>, base = tmp): Promise<InstalledPlugin> {
    const root = join(base, name, "1.0.0");
    await mkdir(root, {recursive: true});
    const manifest = {
        publisher: "fixture",
        name,
        version: "1.0.0",
        engines: {neurobook: ">=0.1.0"},
        entries: Object.fromEntries(Object.entries(entries).map(([id, main]) => [id, {location: "server", main, activationEvents: ["onStartup"]}])),
    };
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
    return {id: `fixture.${name}`, version: "1.0.0", root, digest: "0000000000000000", manifest};
}

function application(plugins: ReadonlyArray<PluginDefinition>): Application {
    const context: HostContext = {identity: {location: "server", instanceId: `loader-${String(Math.random())}`}, stopSignal: new AbortController().signal, emergency: () => undefined};
    return createApplication(context, {plugins, gates: [], backgroundStartupPlugins: plugins.map((plugin) => plugin.id)});
}

function definitions(plugin: InstalledPlugin, records: DiagnosticInput[] = []): PluginDefinition[] {
    return thirdPartyDefinitionsAt("server", [plugin], [], (input) => records.push(input));
}

const COUNTER = `import * as sdk from "@notnotype/nb-plugin-sdk";
let count = 0;
export function activate() {
    count += 1;
    globalThis.__nbookLoaderProbe.calls.push({count, sdk});
    return {};
}
`;

describe("服务端入口代码的装载", () => {
    it("每次激活都是新的模块实例（模块顶层的计数从初始值开始）；SDK 是宿主那一份", async () => {
        const plugin = await installed("counter", {main: "server.js"}, {"server.js": COUNTER});
        for (let round = 0; round < 2; round += 1) {
            const app = application(definitions(plugin));
            expect(await app.startup).toMatchObject({status: "available"});
            expect(await app.plugins.activate({plugin: plugin.id, entry: "main"})).toMatchObject({status: "activated"});
            expect(await app.stop()).toEqual({status: "closed"});
        }
        expect(probe.calls.map((call) => call.count)).toEqual([1, 1]);
        const sdk = probe.calls[0]!.sdk as Record<string, unknown>;
        expect(sdk.defineEntry).toBe(hostSdk.defineEntry);
        expect(sdk.hostClockKey).toBe(hostSdk.hostClockKey);
    });

    it("文件不在、语法错误、没有导出 activate：各自激活失败并带上原因，同一插件的其它入口照常", async () => {
        const plugin = await installed("broken", {ok: "ok.js", missing: "missing.js", syntax: "syntax.js", shape: "shape.js"}, {
            "ok.js": "export const activate = () => ({});\n",
            "syntax.js": "export const activate = (;\n",
            "shape.js": "export const other = 1;\n",
        });
        const app = application(definitions(plugin));
        await app.startup;
        expect(await app.plugins.activate({plugin: plugin.id, entry: "ok"})).toMatchObject({status: "activated"});
        for (const [entry, code] of [["missing", "code-load-failed"], ["syntax", "code-threw"], ["shape", "code-shape"]] as const) {
            const result = await app.plugins.activate({plugin: plugin.id, entry});
            expect(result).toMatchObject({status: "failed", reason: "activation-threw", error: {message: expect.stringContaining(code)}});
        }
        expect(await app.stop()).toEqual({status: "closed"});
    });

    it("模块顶层挂起（顶层 await 不结算）不挡启动：实例照常可用，其它入口照常激活", async () => {
        const opened = Promise.withResolvers<void>();
        probe.gate = opened.promise;
        const plugin = await installed("hangs", {main: "server.js", other: "other.js"}, {
            "server.js": "await globalThis.__nbookLoaderProbe.gate;\nexport const activate = () => ({});\n",
            "other.js": "export const activate = () => ({});\n",
        });
        const app = application(definitions(plugin));
        expect(await app.startup).toMatchObject({status: "available"});
        expect(app.plugins.entryState({plugin: plugin.id, entry: "main"})).toMatchObject({status: "activating"});
        // 启动不等后台的入口：等它自己的这次激活结算。
        expect(await app.plugins.activate({plugin: plugin.id, entry: "other"})).toMatchObject({status: "activated"});
        expect(app.plugins.entryState({plugin: plugin.id, entry: "main"})).toMatchObject({status: "activating"});
        // 放行之后停止才能收口：装载中的 import 不响应停止信号。
        opened.resolve();
        expect(await app.stop()).toEqual({status: "closed"});
    });

    it("插件根目录经符号链接时同样每次激活是新的模块实例（模块缓存按真实路径）", async () => {
        const link = join(tmp, "..", `loader-link-${String(Date.now())}`);
        await symlink(tmp, link);
        try {
            const plugin = await installed("linked", {main: "server.js"}, {"server.js": COUNTER}, link);
            probe.calls.length = 0;
            for (let round = 0; round < 2; round += 1) {
                const app = application(definitions(plugin));
                await app.startup;
                expect(await app.plugins.activate({plugin: plugin.id, entry: "main"})).toMatchObject({status: "activated"});
                expect(await app.stop()).toEqual({status: "closed"});
            }
            expect(probe.calls.map((call) => call.count)).toEqual([1, 1]);
        } finally {
            await rm(link);
        }
    });

    it("导入宿主模块表之外的包：module-not-shared，即使上级目录的 node_modules 里有它；相对导入的文件不在：code-load-failed", async () => {
        await mkdir(join(tmp, "node_modules", "fakepkg"), {recursive: true});
        await writeFile(join(tmp, "node_modules", "fakepkg", "package.json"), JSON.stringify({name: "fakepkg", type: "module", main: "index.js"}));
        await writeFile(join(tmp, "node_modules", "fakepkg", "index.js"), "export const v = 1;\n");
        const plugin = await installed("imports", {pkg: "pkg.js", nested: "nested.js", relative: "relative.js", builtin: "builtin.js"}, {
            "pkg.js": "import {v} from \"fakepkg\";\nexport const activate = () => ({v});\n",
            "nested.js": "import {w} from \"./lib.js\";\nexport const activate = () => ({w});\n",
            "lib.js": "import {v} from \"fakepkg\";\nexport const w = v;\n",
            "relative.js": "import \"./nope.js\";\nexport const activate = () => ({});\n",
            "builtin.js": "import {join} from \"node:path\";\nimport {readFileSync} from \"fs\";\nexport const activate = () => ({join, readFileSync});\n",
        });
        const app = application(definitions(plugin));
        await app.startup;
        for (const [entry, code] of [["pkg", "module-not-shared"], ["nested", "module-not-shared"], ["relative", "code-load-failed"]] as const) {
            expect(await app.plugins.activate({plugin: plugin.id, entry})).toMatchObject({status: "failed", reason: "activation-threw", error: {message: expect.stringContaining(code)}});
        }
        expect(await app.plugins.activate({plugin: plugin.id, entry: "builtin"})).toMatchObject({status: "activated"});
        expect(await app.stop()).toEqual({status: "closed"});
    });

    it("模块顶层抛错之后重试：模块重新求值，条件满足时激活成功；activate 没有返回对象：内核以 activation-threw 结束", async () => {
        const plugin = await installed("transient", {main: "server.js", empty: "empty.js"}, {
            "server.js": "globalThis.__nbookLoaderProbe.evaluations += 1;\nif (!globalThis.__nbookLoaderProbe.ready) throw new Error(\"还没准备好\");\nexport const activate = () => ({});\n",
            "empty.js": "export function activate() {}\n",
        });
        const app = application(definitions(plugin));
        await app.startup;
        expect(await app.plugins.activate({plugin: plugin.id, entry: "main"})).toMatchObject({status: "failed", error: {message: expect.stringContaining("还没准备好")}});
        probe.ready = true;
        // 失败的入口要先恢复（设置窗口的“重试”就是这样做的）才能再激活。
        await app.plugins.recover({plugin: plugin.id, entry: "main"});
        expect(await app.plugins.activate({plugin: plugin.id, entry: "main"})).toMatchObject({status: "activated"});
        expect(probe.evaluations).toBe(2);
        expect(await app.plugins.activate({plugin: plugin.id, entry: "empty"})).toMatchObject({status: "failed", reason: "activation-threw", error: {message: expect.stringContaining("没有返回激活产出")}});
        expect(await app.stop()).toEqual({status: "closed"});
    });

    it("清单读不了的插件不登记，记一条诊断", () => {
        const records: DiagnosticInput[] = [];
        const plugin: InstalledPlugin = {id: "fixture.bad", version: "1.0.0", root: join(tmp, "bad"), digest: "0", manifest: {publisher: "fixture", name: "bad", version: "x"}};
        expect(thirdPartyDefinitionsAt("server", [plugin], [], (input) => records.push(input))).toEqual([]);
        expect(records).toEqual([expect.objectContaining({event: "plugins.startup.manifest-unreadable", data: expect.objectContaining({plugin: "fixture.bad"})})]);
    });
});
