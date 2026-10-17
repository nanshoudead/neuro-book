/**
 * 第三方插件的安装、升级、卸载、启停与启动时的切换和回收（docs/specs/runtime/plugin-install.md）：真实临时目录上的
 * 插件文件夹与状态根，“重启”就是再调一次 `prepareInstalledPlugins` 并用它的结果建新的插件管理。两个服务端进程同时
 * 安装用真实子进程。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {lock} from "proper-lockfile";

import {createPluginInventory} from "./inventory";
import type {PluginInventory} from "./inventory";
import {prepareInstalledPlugins} from "./startup";
import type {StartupPlugins} from "./startup";

const PRODUCT = "0.1.0";
const BUILTIN = [{id: "nbook.settings", version: PRODUCT}];

let tmp = "";
let cases = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-install", "第三方插件的安装与启动");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface World {
    readonly base: string;
    readonly root: string;
    readonly diagnostics: DiagnosticInput[];
    startup: StartupPlugins;
    inventory: PluginInventory;
    /** 模拟重启：处理待生效变化、回收残留，换成新的插件集合与插件管理。 */
    restart(options?: {readonly productVersion?: string; readonly safeMode?: boolean}): Promise<StartupPlugins>;
    /** 在 `base/sources/<name>` 写一个插件文件夹。 */
    source(name: string, manifest: Record<string, unknown>, files?: Readonly<Record<string, string>>): Promise<string>;
    record(): Promise<unknown>;
}

async function world(): Promise<World> {
    cases += 1;
    const base = join(tmp, `case-${String(cases)}`);
    const root = join(base, "state", "plugins");
    await mkdir(join(base, "sources"), {recursive: true});
    const diagnostics: DiagnosticInput[] = [];
    const make = (startup: StartupPlugins, productVersion = PRODUCT): PluginInventory => createPluginInventory({root, productVersion, builtin: BUILTIN, startup, record: (input) => diagnostics.push(input)});
    const self: World = {
        base,
        root,
        diagnostics,
        startup: {safeMode: false, registryProblem: null, plugins: []},
        inventory: make({safeMode: false, registryProblem: null, plugins: []}),
        restart: async (options = {}) => {
            const prepared = await prepareInstalledPlugins({root, productVersion: options.productVersion ?? PRODUCT, safeMode: options.safeMode ?? false});
            diagnostics.push(...prepared.diagnostics);
            self.startup = prepared.startup;
            self.inventory = make(prepared.startup, options.productVersion);
            return prepared.startup;
        },
        source: async (name, manifest, files = {}) => {
            const directory = join(base, "sources", name);
            await mkdir(directory, {recursive: true});
            await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
            for (const [path, text] of Object.entries(files)) {
                await mkdir(join(directory, path, ".."), {recursive: true});
                await writeFile(join(directory, path), text);
            }
            return directory;
        },
        record: async () => JSON.parse(await readFile(join(root, "plugins.json"), "utf8")),
    };
    return self;
}

function manifest(version = "1.0.0", extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        publisher: "example",
        name: "hello",
        version,
        engines: {neurobook: ">=0.1.0"},
        contributes: [{capability: "settings.properties", id: "example.hello/greeting", declaration: {schema: {type: "string"}, default: "hi", layers: ["user", "project"], applies: "now"}}],
        ...extra,
    };
}

async function exists(path: string): Promise<boolean> {
    return stat(path).then(() => true, () => false);
}

async function namesIn(path: string): Promise<string[]> {
    return (await readdir(path).catch(() => [])).sort();
}

function itemOf(listed: Awaited<ReturnType<PluginInventory["list"]>>, id: string) {
    if (!listed.ok) throw new Error(`列表失败：${listed.code}`);
    return listed.value.plugins.find((plugin) => plugin.id === id);
}

describe("安装与列表（输出 1、2、9）", () => {
    it("安装写入登记表为已启用、复制到版本目录；本次运行列为“重启后安装”，重启后登记它的描述", async () => {
        const w = await world();
        const source = await w.source("hello", manifest(), {"README.md": "说明"});
        const installed = await w.inventory.install(source);
        expect(installed).toMatchObject({ok: true, value: {id: "example.hello", version: "1.0.0", source: "third-party", state: "enabled", pending: [{kind: "install"}], notLoaded: null}});
        expect(await w.record()).toEqual({schema: "nbook.plugins/v1", plugins: {"example.hello": {version: "1.0.0", pendingVersion: null, state: "enabled", deleteData: false}}});
        expect(await namesIn(join(w.root, "example.hello", "1.0.0"))).toEqual(["README.md", "package.json"]);
        expect(await namesIn(join(w.root, ".staging"))).toEqual([]);

        const listed = await w.inventory.list();
        expect(itemOf(listed, "nbook.settings")).toEqual({id: "nbook.settings", version: PRODUCT, source: "builtin", state: "enabled", pending: [], notLoaded: null});

        const startup = await w.restart();
        expect(startup.plugins).toEqual([{id: "example.hello", version: "1.0.0", state: "enabled", notLoaded: null, descriptor: {id: "example.hello", version: "1.0.0", locations: [], contributions: manifest().contributes as never}}]);
        expect(itemOf(await w.inventory.list(), "example.hello")?.pending).toEqual([]);
    });

    it("拒绝：保留 id、不兼容、清单无效（带字段）、同一版本、源不存在、源在插件目录里、缺入口文件；都不留下文件与记录", async () => {
        const w = await world();
        expect(await w.inventory.install(await w.source("reserved", {...manifest(), publisher: "nbook", name: ""}))).toMatchObject({ok: false, code: "reserved-id"});
        expect(await w.inventory.install(await w.source("future", manifest("1.0.0", {engines: {neurobook: ">=2.0.0"}})))).toMatchObject({ok: false, code: "incompatible-engine"});
        const invalid = await w.inventory.install(await w.source("invalid", manifest("1.0")));
        expect(invalid).toMatchObject({ok: false, code: "manifest-invalid"});
        expect(invalid.ok ? [] : invalid.problems).toEqual([expect.stringMatching(/^version：/u)]);
        expect(await w.inventory.install(join(w.base, "sources", "nothing"))).toMatchObject({ok: false, code: "path-rejected"});
        expect(await w.inventory.install(await w.source("no-entry", manifest("1.0.0", {entries: {ui: {location: "browser", main: "dist/ui.js"}}})))).toMatchObject({ok: false, code: "entry-missing"});
        expect(await exists(join(w.root, "plugins.json"))).toBe(false);

        const source = await w.source("hello", manifest());
        expect(await w.inventory.install(source)).toMatchObject({ok: true});
        expect(await w.inventory.install(source)).toMatchObject({ok: false, code: "already-installed"});
        expect(await w.inventory.install(join(w.root, "example.hello", "1.0.0"))).toMatchObject({ok: false, code: "path-rejected"});
        expect(await namesIn(w.root)).toEqual([".staging", "example.hello", "plugins.json"]);
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["1.0.0"]);
        expect(await namesIn(join(w.root, ".staging"))).toEqual([]);
    });
});

describe("复制范围（输入与前置条件、场景 10）", () => {
    it("files 按 npm 规则：命中目录递归、glob 与排除项、总带 package.json、总排除 node_modules；没有 files 时整目录", async () => {
        const w = await world();
        const source = await w.source("ranged", manifest("1.0.0", {files: ["dist", "*.md", "!dist/test"], entries: {ui: {location: "browser", main: "dist/ui.js"}}}), {
            "dist/ui.js": "",
            "dist/deep/chunk.js": "",
            "dist/test/case.js": "",
            "dist/node_modules/x.js": "",
            "README.md": "",
            "src/ui.ts": "",
        });
        expect(await w.inventory.install(source)).toMatchObject({ok: true});
        const target = join(w.root, "example.hello", "1.0.0");
        expect(await namesIn(target)).toEqual(["README.md", "dist", "package.json"]);
        expect(await namesIn(join(target, "dist"))).toEqual(["deep", "ui.js"]);

        const whole = await w.source("whole", manifest("2.0.0"), {"lib/a.js": "", "node_modules/dep/index.js": "", ".git/HEAD": ""});
        expect(await w.inventory.install(whole)).toMatchObject({ok: true});
        expect(await namesIn(join(w.root, "example.hello", "2.0.0"))).toEqual(["lib", "package.json"]);
    });

    it("复制范围内的符号链接被拒：中间目录、末级文件、package.json 本身；范围外的链接不影响安装", async () => {
        const w = await world();
        const outside = join(w.base, "outside");
        await mkdir(outside, {recursive: true});
        await writeFile(join(outside, "ui.js"), "");

        const middle = await w.source("middle", manifest("1.0.0", {files: ["lib/ui.js"]}));
        await symlink(outside, join(middle, "lib"));
        expect(await w.inventory.install(middle)).toMatchObject({ok: false, code: "path-rejected"});

        const leaf = await w.source("leaf", manifest("1.0.0", {files: ["dist"]}), {"dist/a.js": ""});
        await symlink(join(outside, "ui.js"), join(leaf, "dist", "ui.js"));
        expect(await w.inventory.install(leaf)).toMatchObject({ok: false, code: "path-rejected"});

        const linkedManifest = join(w.base, "sources", "linked-manifest");
        await mkdir(linkedManifest, {recursive: true});
        await writeFile(join(outside, "package.json"), JSON.stringify(manifest()));
        await symlink(join(outside, "package.json"), join(linkedManifest, "package.json"));
        expect(await w.inventory.install(linkedManifest)).toMatchObject({ok: false, code: "path-rejected"});

        const unrelated = await w.source("unrelated", manifest("1.0.0", {files: ["dist"]}), {"dist/a.js": ""});
        await symlink(outside, join(unrelated, "docs"));
        expect(await w.inventory.install(unrelated)).toMatchObject({ok: true});
        expect(await namesIn(join(w.base, "state", "plugins", ".staging"))).toEqual([]);
    });

    it("复制中途失败：copy-failed，准备目录删除，不留登记表记录", async () => {
        const w = await world();
        const source = await w.source("unreadable", manifest(), {"secret.js": ""});
        await chmod(join(source, "secret.js"), 0o000);
        try {
            expect(await w.inventory.install(source)).toMatchObject({ok: false, code: "copy-failed"});
        } finally {
            await chmod(join(source, "secret.js"), 0o644);
        }
        expect(await exists(join(w.root, "plugins.json"))).toBe(false);
        expect(await namesIn(join(w.root, ".staging"))).toEqual([]);
        expect(await exists(join(w.root, "example.hello"))).toBe(false);
    });
});

describe("升级（输出 8、场景 12、16）", () => {
    it("安装另一版本记为待切换；待切换期间再换版本时先改登记表、再删被取代的目录；重启后切到新版本、删旧目录", async () => {
        const w = await world();
        expect(await w.inventory.install(await w.source("v1", manifest("1.0.0")))).toMatchObject({ok: true});
        await w.restart();
        const v2 = await w.inventory.install(await w.source("v2", manifest("2.0.0")));
        expect(v2).toMatchObject({ok: true, value: {version: "1.0.0", pending: [{kind: "upgrade", version: "2.0.0"}]}});
        const v3 = await w.inventory.install(await w.source("v3", manifest("3.0.0")));
        expect(v3).toMatchObject({ok: true, value: {version: "1.0.0", pending: [{kind: "upgrade", version: "3.0.0"}]}});
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["1.0.0", "3.0.0"]);
        // 与当前版本或待切换版本相同都拒绝：待切换不能靠再装旧版本撤销。
        expect(await w.inventory.install(await w.source("v1-again", manifest("1.0.0")))).toMatchObject({ok: false, code: "already-installed"});
        expect(await w.inventory.install(await w.source("v3-again", manifest("3.0.0")))).toMatchObject({ok: false, code: "already-installed"});

        const startup = await w.restart();
        expect(startup.plugins).toMatchObject([{id: "example.hello", version: "3.0.0", state: "enabled"}]);
        expect(await w.record()).toMatchObject({plugins: {"example.hello": {version: "3.0.0", pendingVersion: null}}});
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["3.0.0"]);
        expect(w.diagnostics.some((record) => record.event === "plugins.upgrade.switched")).toBe(true);
    });

    it("已禁用的插件升级后仍为已禁用，只切换文件与登记", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0")));
        await w.restart();
        await w.inventory.setEnabled("example.hello", false);
        await w.inventory.install(await w.source("v2", manifest("2.0.0")));
        const startup = await w.restart();
        expect(startup.plugins).toEqual([{id: "example.hello", version: "2.0.0", state: "disabled", descriptor: null, notLoaded: null}]);
    });
});

describe("启停与卸载（输出 3、4、场景 13、14、16）", () => {
    it("启用与禁用互相覆盖；内置插件 builtin-fixed；未安装 not-installed", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await w.restart();
        expect(await w.inventory.setEnabled("example.hello", false)).toMatchObject({ok: true, value: {state: "disabled", pending: [{kind: "disable"}]}});
        expect(await w.inventory.setEnabled("example.hello", true)).toMatchObject({ok: true, value: {state: "enabled", pending: []}});
        await w.inventory.setEnabled("example.hello", false);
        expect((await w.restart()).plugins).toMatchObject([{state: "disabled", descriptor: null}]);
        expect(await w.inventory.setEnabled("nbook.settings", false)).toMatchObject({ok: false, code: "builtin-fixed"});
        expect(await w.inventory.uninstall("nbook.settings")).toMatchObject({ok: false, code: "builtin-fixed"});
        expect(await w.inventory.setEnabled("example.missing", true)).toMatchObject({ok: false, code: "not-installed"});
        expect(await w.inventory.uninstall("example.missing")).toMatchObject({ok: false, code: "not-installed"});
    });

    it("卸载只标记卸载中、本次不删文件；卸载中再安装或启停被拒；重启后删目录并移除记录", async () => {
        const w = await world();
        const source = await w.source("hello", manifest());
        await w.inventory.install(source);
        await w.restart();
        expect(await w.inventory.uninstall("example.hello")).toMatchObject({ok: true, value: {state: "uninstalling", pending: [{kind: "uninstall"}]}});
        expect(await exists(join(w.root, "example.hello", "1.0.0", "package.json"))).toBe(true);
        expect(await w.inventory.install(source)).toMatchObject({ok: false, code: "uninstall-pending"});
        expect(await w.inventory.install(await w.source("v2", manifest("2.0.0")))).toMatchObject({ok: false, code: "uninstall-pending"});
        expect(await w.inventory.setEnabled("example.hello", true)).toMatchObject({ok: false, code: "uninstall-pending"});

        expect((await w.restart()).plugins).toEqual([]);
        expect(await w.record()).toEqual({schema: "nbook.plugins/v1", plugins: {}});
        expect(await exists(join(w.root, "example.hello"))).toBe(false);
        expect(await w.inventory.install(source)).toMatchObject({ok: true});
    });
});

describe("启动时的登记（输出 6、7）与回收（提交点表）", () => {
    it("不兼容、清单无效与安全模式不登记，原因可查，用户状态不变；有入口的插件只登记顶层声明", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await w.inventory.install(await w.source("entries", {...manifest(), name: "entries", contributes: [], entries: {ui: {location: "browser", main: "ui.js"}}}, {"ui.js": ""}));
        await w.inventory.install(await w.source("broken", {...manifest(), name: "broken"}));
        await writeFile(join(w.root, "example.broken", "1.0.0", "package.json"), "{");

        const startup = await w.restart();
        expect(startup.plugins.map((plugin) => [plugin.id, plugin.notLoaded?.code ?? null, plugin.descriptor === null])).toEqual([
            ["example.broken", "manifest-invalid", true],
            ["example.entries", "entries-not-loaded", false],
            ["example.hello", null, false],
        ]);

        const older = await w.restart({productVersion: "0.0.9"});
        expect(older.plugins.find((plugin) => plugin.id === "example.hello")).toMatchObject({state: "enabled", descriptor: null, notLoaded: {code: "incompatible-engine"}});
        expect(itemOf(await w.inventory.list(), "example.hello")).toMatchObject({state: "enabled", notLoaded: {code: "incompatible-engine"}});

        const safe = await w.restart({safeMode: true});
        expect(safe.plugins.every((plugin) => plugin.descriptor === null && plugin.notLoaded?.code === "safe-mode")).toBe(true);
        expect((await w.inventory.list()).ok && (await w.inventory.list())).toMatchObject({value: {safeMode: true}});
        // 安全模式下可以禁用与卸载。
        expect(await w.inventory.setEnabled("example.hello", false)).toMatchObject({ok: true});
        expect(await w.inventory.uninstall("example.broken")).toMatchObject({ok: true});
    });

    it("回收：没被引用的版本目录、没有记录的插件目录、登记表的临时文件、没持锁的准备目录；别的进程持锁的准备目录保留", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await mkdir(join(w.root, "example.hello", "0.9.0"), {recursive: true});
        await mkdir(join(w.root, "example.ghost", "1.0.0"), {recursive: true});
        await writeFile(join(w.root, ".plugins.json.0000.tmp"), "{");
        await mkdir(join(w.root, ".staging", "crashed"), {recursive: true});
        await mkdir(join(w.root, ".staging", "preparing"), {recursive: true});
        const held = join(w.root, ".staging", "preparing.lock");
        const release = await lock(held, {realpath: false, lockfilePath: held});
        try {
            await w.restart();
            expect(await namesIn(w.root)).toEqual([".staging", "example.hello", "plugins.json"]);
            expect(await namesIn(join(w.root, "example.hello"))).toEqual(["1.0.0"]);
            expect(await namesIn(join(w.root, ".staging"))).toEqual(["preparing", "preparing.lock"]);
        } finally {
            await release();
        }
    });

    it("登记表无效：不加载任何第三方插件、不动任何文件；管理操作 registry-failed", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await writeFile(join(w.root, "plugins.json"), JSON.stringify({schema: "nbook.plugins/v0"}));
        const startup = await w.restart();
        expect(startup).toMatchObject({plugins: [], registryProblem: expect.stringContaining("nbook.plugins/v1")});
        expect(await exists(join(w.root, "example.hello", "1.0.0", "package.json"))).toBe(true);
        expect(await w.inventory.list()).toMatchObject({ok: false, code: "registry-failed"});
        expect(await w.inventory.install(await w.source("other", {...manifest(), name: "other"}))).toMatchObject({ok: false, code: "registry-failed"});
        expect(JSON.parse(await readFile(join(w.root, "plugins.json"), "utf8"))).toEqual({schema: "nbook.plugins/v0"});
    });
});

describe("同一状态根上的两个服务端进程（场景 15）", () => {
    it("两个进程同时安装不同插件，登记表两条都在", async () => {
        const w = await world();
        const sources = [
            await w.source("a", {...manifest(), name: "alpha"}, Object.fromEntries(Array.from({length: 40}, (_, index) => [`dist/${String(index)}.js`, "x".repeat(4096)]))),
            await w.source("b", {...manifest(), name: "beta"}, Object.fromEntries(Array.from({length: 40}, (_, index) => [`dist/${String(index)}.js`, "y".repeat(4096)]))),
        ];
        const children = sources.map((source) => Bun.spawn({
            cmd: [process.execPath, join(import.meta.dir, "testing", "install-child.ts"), w.root, source],
            stdout: "pipe",
            stderr: "pipe",
        }));
        const outputs = await Promise.all(children.map(async (child) => ({code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text()})));
        for (const output of outputs) expect(output, output.err).toMatchObject({code: 0, out: expect.stringContaining("\"ok\":true")});
        expect(Object.keys(((await w.record()) as {plugins: Record<string, unknown>}).plugins).sort()).toEqual(["example.alpha", "example.beta"]);
    });
});
