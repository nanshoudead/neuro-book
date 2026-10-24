/**
 * 第三方插件的安装、升级、卸载、启停与启动时的切换和回收（docs/specs/runtime/plugin-install.md）：真实临时目录上的
 * 插件文件夹与状态根，“重启”就是再调一次 `prepareInstalledPlugins` 并用它的结果建新的插件管理。两个服务端进程同时
 * 安装用真实子进程。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {lock} from "proper-lockfile";

import {acmeAt, ACME_PROFILE} from "../testing/profile";
import {createPluginInventory} from "./inventory";
import type {PluginInventory} from "./inventory";
import {livePins, pinKey, pinVersions, PINS_DIR} from "./pins";
import {prepareInstalledPlugins} from "./startup";
import type {PluginsPreparation, StartupPlugins} from "./startup";

const PRODUCT = ACME_PROFILE.productVersion;
const BUILTIN = [{id: "acme.settings", version: PRODUCT}];

let tmp = "";
let cases = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-install", "第三方插件的安装与启动");
});

/** 每次模拟启动都持一份版本租约；用例结束后放下，免得锁的刷新计时器留在进程里。 */
const releases: PluginsPreparation[] = [];

afterAll(async () => {
    for (const prepared of releases.splice(0)) await prepared.release();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface World {
    readonly base: string;
    readonly root: string;
    readonly diagnostics: DiagnosticInput[];
    startup: StartupPlugins;
    inventory: PluginInventory;
    /** 模拟重启：上一次的服务端退出（放下版本租约），再处理待生效变化、回收残留，换成新的插件集合与插件管理。 */
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
    const make = (startup: StartupPlugins, productVersion = PRODUCT): PluginInventory => createPluginInventory({root, profile: acmeAt(productVersion), builtin: BUILTIN, startup, record: (input) => diagnostics.push(input)});
    let running: PluginsPreparation | null = null;
    const self: World = {
        base,
        root,
        diagnostics,
        startup: {safeMode: false, registryProblem: null, plugins: []},
        inventory: make({safeMode: false, registryProblem: null, plugins: []}),
        restart: async (options = {}) => {
            await running?.release();
            const prepared = await prepareInstalledPlugins({root, profile: acmeAt(options.productVersion ?? PRODUCT), safeMode: options.safeMode ?? false});
            running = prepared;
            releases.push(prepared);
            prepared.connectDiagnostics((input) => diagnostics.push(input));
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
        engines: {acme: ">=0.1.0"},
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
        expect(await w.record()).toEqual({schema: "acme.plugins/v1", plugins: {"example.hello": {version: "1.0.0", pendingVersion: null, state: "enabled", deleteData: false}}});
        expect(await namesIn(join(w.root, "example.hello", "1.0.0"))).toEqual(["README.md", "package.json"]);
        expect(await namesIn(join(w.root, ".staging"))).toEqual([]);

        const listed = await w.inventory.list();
        expect(itemOf(listed, "acme.settings")).toEqual({id: "acme.settings", version: PRODUCT, source: "builtin", state: "enabled", pending: [], notLoaded: null});

        const startup = await w.restart();
        expect(startup.plugins).toEqual([{
            id: "example.hello",
            version: "1.0.0",
            state: "enabled",
            notLoaded: null,
            descriptor: {id: "example.hello", version: "1.0.0", locations: [], contributions: manifest().contributes as never},
            installed: {id: "example.hello", version: "1.0.0", root: join(w.root, "example.hello", "1.0.0"), digest: expect.stringMatching(/^[0-9a-f]{16}$/u), manifest: manifest()},
        }]);
        expect(itemOf(await w.inventory.list(), "example.hello")?.pending).toEqual([]);
    });

    it("拒绝：保留 id、不兼容、清单无效（带字段）、同一版本、源不存在、源在插件目录里、缺入口文件；都不留下文件与记录", async () => {
        const w = await world();
        const reserved = await w.inventory.install(await w.source("reserved", {...manifest(), publisher: "acme"}));
        expect(reserved).toMatchObject({ok: false, code: "manifest-invalid"});
        expect(reserved.ok ? [] : reserved.problems).toEqual([expect.stringMatching(/^publisher：/u)]);
        expect(await w.inventory.install(await w.source("future", manifest("1.0.0", {engines: {acme: ">=2.0.0"}})))).toMatchObject({ok: false, code: "incompatible-engine"});
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

    it("安装源在插件目录里时拒绝，目录名以 .. 开头的子目录也算在里面", async () => {
        const w = await world();
        const inside = join(w.root, "..stash", "hello");
        await mkdir(inside, {recursive: true});
        await writeFile(join(inside, "package.json"), JSON.stringify(manifest()));
        expect(await w.inventory.install(inside)).toMatchObject({ok: false, code: "path-rejected"});
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

        // npm 总是包含的：README、LICENSE 与 main 指向的文件，即使 files 为空。
        const always = await w.source("always", manifest("3.0.0", {files: [], main: "index.js"}), {"index.js": "", "README.md": "", "LICENSE": "", "notes.txt": ""});
        expect(await w.inventory.install(always)).toMatchObject({ok: true});
        expect(await namesIn(join(w.root, "example.hello", "3.0.0"))).toEqual(["LICENSE", "README.md", "index.js", "package.json"]);

        // 总是包含的只是文件：main 指向目录、README 是目录时都不递归复制，目录里的链接也不在范围内。
        const directories = await w.source("always-directories", manifest("4.0.0", {files: [], main: "lib"}), {"lib/a.js": "", "README.md/inner.txt": ""});
        await symlink(join(directories, "lib", "a.js"), join(directories, "lib", "link.js"));
        expect(await w.inventory.install(directories)).toMatchObject({ok: true});
        expect(await namesIn(join(w.root, "example.hello", "4.0.0"))).toEqual(["package.json"]);
    });

    it("files 写了 npm 的扩展 glob：清单无效，不静默少复制", async () => {
        const w = await world();
        const source = await w.source("extglob", manifest("1.0.0", {files: ["+(dist|lib)"]}), {"dist/a.js": "", "lib/b.js": ""});
        expect(await w.inventory.install(source)).toMatchObject({ok: false, code: "manifest-invalid"});
        expect(await w.inventory.install(await w.source("negated-extglob", manifest("1.0.0", {files: ["dist", "!(src)"]}), {"dist/a.js": ""}))).toMatchObject({ok: false, code: "manifest-invalid"});
        // 没有配对的括号不是扩展 glob，是文件名里的普通字符。
        const literal = await w.source("literal", manifest("1.0.0", {files: ["x@(draft.txt"]}), {"x@(draft.txt": ""});
        expect(await w.inventory.install(literal)).toMatchObject({ok: true});
        expect(await namesIn(join(w.root, "example.hello", "1.0.0"))).toEqual(["package.json", "x@(draft.txt"]);
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

        // 排除项剪掉的目录不在范围内，里面的链接同样不影响安装。
        const excluded = await w.source("excluded", manifest("2.0.0", {files: ["dist", "!dist/tests"]}), {"dist/a.js": ""});
        await mkdir(join(excluded, "dist", "tests"), {recursive: true});
        await symlink(join(outside, "ui.js"), join(excluded, "dist", "tests", "link.js"));
        expect(await w.inventory.install(excluded)).toMatchObject({ok: true});
        expect(await namesIn(join(w.base, "state", "plugins", "example.hello", "2.0.0", "dist"))).toEqual(["a.js"]);
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
        // 确认之前的预览：只读，区分升级与降级，冲突照样报出。
        expect(await w.inventory.inspect(await w.source("v4", manifest("4.0.0")))).toEqual({ok: true, value: {id: "example.hello", version: "4.0.0", installed: "1.0.0", relation: "upgrade", blocked: [], unchecked: []}});
        expect(await w.inventory.inspect(await w.source("v0", manifest("0.9.0")))).toEqual({ok: true, value: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade", blocked: [], unchecked: []}});
        expect(await w.inventory.inspect(await w.source("v3-peek", manifest("3.0.0")))).toMatchObject({ok: false, code: "already-installed"});
        // 只差构建元数据的版本不是降级；`v1.0.0` 这类非规范写法不是合法版本，免得同一版本装成两个目录。
        expect(await w.inventory.inspect(await w.source("v1-build", manifest("1.0.0+build.2")))).toMatchObject({ok: true, value: {relation: "upgrade", blocked: [], unchecked: []}});
        expect(await w.inventory.inspect(await w.source("v1-alias", manifest("v1.0.0")))).toMatchObject({ok: false, code: "manifest-invalid"});
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["1.0.0", "3.0.0"]);
        expect(await w.inventory.install(await w.source("v1-again", manifest("1.0.0")))).toMatchObject({ok: false, code: "already-installed"});
        expect(await w.inventory.install(await w.source("v3-again", manifest("3.0.0")))).toMatchObject({ok: false, code: "already-installed"});

        const startup = await w.restart();
        expect(startup.plugins).toMatchObject([{id: "example.hello", version: "3.0.0", state: "enabled"}]);
        expect(await w.record()).toMatchObject({plugins: {"example.hello": {version: "3.0.0", pendingVersion: null}}});
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["3.0.0"]);
        expect(w.diagnostics.some((record) => record.event === "plugins.upgrade.switched")).toBe(true);
    });

    it("首次安装后、重启之前又换了版本：列表写重启后要装上的版本", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0")));
        await w.inventory.setEnabled("example.hello", false);
        const v2 = await w.inventory.install(await w.source("v2", manifest("2.0.0")));
        expect(v2).toMatchObject({ok: true, value: {version: "2.0.0", pending: [{kind: "install"}, {kind: "disable"}]}});
        expect(itemOf(await w.inventory.list(), "example.hello")).toMatchObject({version: "2.0.0", pending: [{kind: "install"}, {kind: "disable"}]});
        expect((await w.restart()).plugins).toMatchObject([{id: "example.hello", version: "2.0.0", state: "disabled"}]);
    });

    it("已禁用的插件升级后仍为已禁用，只切换文件与登记", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0")));
        await w.restart();
        await w.inventory.setEnabled("example.hello", false);
        await w.inventory.install(await w.source("v2", manifest("2.0.0")));
        const startup = await w.restart();
        expect(startup.plugins).toEqual([{id: "example.hello", version: "2.0.0", state: "disabled", descriptor: null, installed: null, notLoaded: null}]);
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
        expect(await w.inventory.setEnabled("acme.settings", false)).toMatchObject({ok: false, code: "builtin-fixed"});
        expect(await w.inventory.uninstall("acme.settings")).toMatchObject({ok: false, code: "builtin-fixed"});
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
        expect(await w.record()).toEqual({schema: "acme.plugins/v1", plugins: {}});
        expect(await exists(join(w.root, "example.hello"))).toBe(false);
        expect(await w.inventory.install(source)).toMatchObject({ok: true});
    });
});

describe("启动时的登记（输出 6、7）与回收（提交点表）", () => {
    it("不兼容、清单无效、入口文件缺失与安全模式不登记，原因可查，用户状态不变；有入口的插件照常登记", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await w.inventory.install(await w.source("entries", {...manifest(), name: "entries", contributes: [], entries: {ui: {location: "browser", main: "ui.js"}}}, {"ui.js": ""}));
        await w.inventory.install(await w.source("broken", {...manifest(), name: "broken"}));
        await writeFile(join(w.root, "example.broken", "1.0.0", "package.json"), "{");
        await w.inventory.install(await w.source("lost", {...manifest(), name: "lost", contributes: [], entries: {ui: {location: "browser", main: "ui.js"}}}, {"ui.js": ""}));
        await rm(join(w.root, "example.lost", "1.0.0", "ui.js"));

        const startup = await w.restart();
        expect(startup.plugins.map((plugin) => [plugin.id, plugin.notLoaded?.code ?? null, plugin.descriptor === null])).toEqual([
            ["example.broken", "manifest-invalid", true],
            ["example.entries", null, false],
            ["example.hello", null, false],
            // 安装时有、之后被删掉的入口文件：与安装时同一个码。
            ["example.lost", "entry-missing", true],
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
            expect(await namesIn(w.root)).toEqual([".pins", ".staging", "example.hello", "plugins.json"]);
            expect(await namesIn(join(w.root, "example.hello"))).toEqual(["1.0.0"]);
            expect(await namesIn(join(w.root, ".staging"))).toEqual(["preparing", "preparing.lock"]);
        } finally {
            await release();
        }
    });

    it("登记表无效：不加载任何第三方插件、不动任何文件；管理操作 registry-failed", async () => {
        const w = await world();
        await w.inventory.install(await w.source("hello", manifest()));
        await writeFile(join(w.root, "plugins.json"), JSON.stringify({schema: "acme.plugins/v0"}));
        const startup = await w.restart();
        expect(startup).toMatchObject({plugins: [], registryProblem: expect.stringContaining("acme.plugins/v1")});
        expect(await exists(join(w.root, "example.hello", "1.0.0", "package.json"))).toBe(true);
        expect(await w.inventory.list()).toMatchObject({ok: false, code: "registry-failed"});
        expect(await w.inventory.install(await w.source("other", {...manifest(), name: "other"}))).toMatchObject({ok: false, code: "registry-failed"});
        expect(JSON.parse(await readFile(join(w.root, "plugins.json"), "utf8"))).toEqual({schema: "acme.plugins/v0"});
    });

    it("登记表里的 id 或版本不能当路径用：整表不可用，启动不删安装根之外的任何东西", async () => {
        const w = await world();
        const victim = join(w.base, "state", "user-data");
        await mkdir(victim, {recursive: true});
        await writeFile(join(victim, "keep.txt"), "作品数据");
        await mkdir(w.root, {recursive: true});
        for (const plugins of [
            {"../user-data": {version: "1.0.0", pendingVersion: null, state: "uninstalling", deleteData: false}},
            {"example.hello": {version: "../../user-data", pendingVersion: null, state: "enabled", deleteData: false}},
        ]) {
            await writeFile(join(w.root, "plugins.json"), JSON.stringify({schema: "acme.plugins/v1", plugins}));
            expect((await w.restart()).registryProblem).toEqual(expect.any(String));
            expect(await readFile(join(victim, "keep.txt"), "utf8")).toBe("作品数据");
        }
    });

    it("安装根里的目录换成了指向外面的符号链接：安装与回收都不跟着链接删改", async () => {
        const w = await world();
        const victim = join(w.base, "state", "user-data");
        await mkdir(join(victim, "1.0.0"), {recursive: true});
        await mkdir(join(victim, "draft"), {recursive: true});
        await writeFile(join(victim, "1.0.0", "keep.txt"), "作品数据");
        await writeFile(join(victim, "draft", "keep.txt"), "作品数据");
        await mkdir(w.root, {recursive: true});
        await symlink(victim, join(w.root, "example.hello"));
        expect(await w.inventory.install(await w.source("hello", manifest()))).toMatchObject({ok: false, code: "copy-failed"});
        await rm(join(w.root, ".staging"), {recursive: true});
        await symlink(victim, join(w.root, ".staging"));
        await w.restart();
        expect(await namesIn(victim)).toEqual(["1.0.0", "draft"]);
        expect(await readFile(join(victim, "1.0.0", "keep.txt"), "utf8")).toBe("作品数据");
        expect(await readFile(join(victim, "draft", "keep.txt"), "utf8")).toBe("作品数据");
    });
});

describe("同一状态根上的两个服务端进程（场景 15）", () => {
    it("另一个服务端启动时切换了版本、完成了卸载：本进程的列表仍按自己启动时的集合给出待生效变化", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0")));
        await w.inventory.install(await w.source("other", {...manifest(), name: "other"}));
        await w.restart();
        const mine = w.inventory;
        await mine.install(await w.source("v2", manifest("2.0.0")));
        await mine.uninstall("example.other");
        // 另一个服务端在同一状态根上启动：消费掉待切换版本与卸载记录。
        releases.push(await prepareInstalledPlugins({root: w.root, profile: ACME_PROFILE, safeMode: false}));
        expect(await w.record()).toMatchObject({plugins: {"example.hello": {version: "2.0.0", pendingVersion: null}}});
        const listed = await mine.list();
        expect(itemOf(listed, "example.hello")).toMatchObject({version: "1.0.0", pending: [{kind: "upgrade", version: "2.0.0"}]});
        expect(itemOf(listed, "example.other")).toMatchObject({pending: [{kind: "uninstall"}]});
    });


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

    it("版本租约：另一个服务端启动时切换版本、移除卸载记录，但本服务端在用的版本目录留到它退出之后才回收", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0"), {"web.js": "v1"}));
        await w.inventory.install(await w.source("other", {...manifest(), name: "other"}, {"web.js": "o"}));
        await w.restart();
        await w.inventory.install(await w.source("v2", manifest("2.0.0"), {"web.js": "v2"}));
        await w.inventory.uninstall("example.other");
        const second = async (): Promise<string[]> => {
            const child = Bun.spawn({cmd: [process.execPath, join(import.meta.dir, "testing", "prepare-child.ts"), w.root], stdout: "pipe", stderr: "pipe"});
            const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            expect(code, err).toBe(0);
            return JSON.parse(out) as string[];
        };

        // 另一个服务端（真实子进程）启动：登记表切到 2.0.0、移除 other；本服务端还租着 1.0.0 与 other，文件都在。
        expect(await second()).toEqual(["example.hello@2.0.0"]);
        expect(await w.record()).toEqual({schema: "acme.plugins/v1", plugins: {"example.hello": {version: "2.0.0", pendingVersion: null, state: "enabled", deleteData: false}}});
        expect(await readFile(join(w.root, "example.hello", "1.0.0", "web.js"), "utf8")).toBe("v1");
        expect(await readFile(join(w.root, "example.other", "1.0.0", "web.js"), "utf8")).toBe("o");
        // 租着的目录不被重装换掉：同一版本的新内容 version-in-use，本服务端在用的文件不变。
        expect(await w.inventory.install(await w.source("other-again", {...manifest(), name: "other"}, {"web.js": "o2"}))).toMatchObject({ok: false, code: "version-in-use"});
        expect(await w.inventory.install(await w.source("v1-again", manifest("1.0.0"), {"web.js": "v1b"}))).toMatchObject({ok: false, code: "version-in-use"});
        expect(await readFile(join(w.root, "example.other", "1.0.0", "web.js"), "utf8")).toBe("o");
        expect(await readFile(join(w.root, "example.hello", "1.0.0", "web.js"), "utf8")).toBe("v1");

        // 本服务端退出（放下租约）后，下一次启动才回收。
        await w.restart();
        expect(await namesIn(join(w.root, "example.hello"))).toEqual(["2.0.0"]);
        expect(await exists(join(w.root, "example.other"))).toBe(false);
        expect(await namesIn(join(w.root, ".pins"))).toHaveLength(2);
    });

    it("版本租约的锁被别的服务端当作残留删掉（持有者暂停过久）：换名重写、记诊断，回收的一方随后仍看到这些版本在用；放下后不留锁", async () => {
        const w = await world();
        await mkdir(w.root, {recursive: true});
        const reports: string[] = [];
        const stale = 2_000;
        const pin = await pinVersions(w.root, [{id: "example.hello", version: "1.0.0"}], (event) => reports.push(event), {stale});
        expect(pin).not.toBeNull();
        const [lockName] = (await readdir(join(w.root, PINS_DIR))).filter((name) => name.endsWith(".lock"));
        // 持有者暂停期间锁没有刷新：把锁的修改时间拨回过期之前，另一个服务端的回收按残留删掉它。
        const past = new Date(Date.now() - stale * 3);
        await utimes(join(w.root, PINS_DIR, lockName!), past, past);
        expect((await livePins(w.root, () => undefined, {stale})).pinned.size).toBe(0);
        await waitUntil("租约换名重写", () => (reports.includes("pins.renewed") ? true : undefined), {timeoutMs: stale * 3});
        expect(reports).toContain("lock.compromised");
        expect((await livePins(w.root, () => undefined, {stale})).pinned).toEqual(new Set([pinKey("example.hello", "1.0.0")]));
        await pin!.release();
        expect(await namesIn(join(w.root, PINS_DIR))).toEqual([]);
    });

    it("被取代的待切换版本还被别的服务端租着：再装新版本时它的目录保留、推迟回收", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0"), {"web.js": "v1"}));
        await w.restart();
        await w.inventory.install(await w.source("v2", manifest("2.0.0"), {"web.js": "v2"}));
        // 另一个服务端已切到 2.0.0 并在用它（同一进程里写一份独立的租约代表它）。
        const other = await pinVersions(w.root, [{id: "example.hello", version: "2.0.0"}], () => undefined);
        try {
            expect(await w.inventory.install(await w.source("v3", manifest("3.0.0"), {"web.js": "v3"}))).toMatchObject({ok: true});
            expect(await readFile(join(w.root, "example.hello", "2.0.0", "web.js"), "utf8")).toBe("v2");
            expect(w.diagnostics.map((record) => record.event)).toContain("plugins.cleanup.deferred");
        } finally {
            await other?.release();
        }
    });

    it("安装根只读：拿不到登记表锁、写不下版本租约，照常只读启动并登记插件，原因进诊断", async () => {
        const w = await world();
        await w.inventory.install(await w.source("v1", manifest("1.0.0"), {"web.js": "v1"}));
        await chmod(w.root, 0o555);
        try {
            const startup = await w.restart();
            expect(startup.plugins.map((plugin) => plugin.id)).toEqual(["example.hello"]);
            expect(w.diagnostics.map((record) => record.event)).toEqual(expect.arrayContaining(["plugins.startup.unlocked", "plugins.pins.write-failed"]));
        } finally {
            await chmod(w.root, 0o755);
        }
    });

    it("升级预览：同一插件的几个入口原因不同，各占一行，范围与服务只跟着自己的入口", async () => {
        const w = await world();
        const plugin = (name: string, version: string, extra: Record<string, unknown> = {}) => ({...manifest(version), name, contributes: [], ...extra});
        await w.inventory.install(await w.source("tts1", plugin("tts", "1.0.0", {entries: {main: {location: "server", main: "main.js", provides: ["example.tts/voice", "example.tts/other"]}}}), {"main.js": ""}));
        await w.inventory.install(await w.source("reader", plugin("reader", "1.0.0", {
            entries: {a: {location: "server", main: "a.js", requires: ["example.tts/voice"]}, b: {location: "server", main: "b.js", requires: ["example.tts/other"]}},
            pluginVersions: {"example.tts": "^1.0.0"},
        }), {"a.js": "", "b.js": ""}));
        await w.restart();
        // tts 升到范围外、并且不再提供 other：reader 的 a 入口版本不符，b 入口缺服务，各占一行。
        const preview = await w.inventory.inspect(await w.source("tts2", plugin("tts", "2.0.0", {entries: {main: {location: "server", main: "main.js", provides: ["example.tts/voice"]}}}), {"main.js": ""}));
        expect(preview).toMatchObject({ok: true, value: {blocked: [
            {plugin: "example.reader", entries: ["a"], reason: "version-mismatch", range: "^1.0.0"},
            {plugin: "example.reader", entries: ["b"], reason: "missing-service", service: "example.tts/other"},
        ]}});
    });

    it("升级预览列出重启后会受阻的插件（plugin-install 输出 8.1）：版本不符的与经它传递受阻的；禁用的不算；读不了清单的列为没核对", async () => {
        const w = await world();
        const entry = (extra: Record<string, unknown>) => ({entries: {main: {location: "server", main: "main.js", ...extra}}});
        const plugin = (name: string, version: string, extra: Record<string, unknown> = {}) => ({...manifest(version), name, contributes: [], ...extra});
        await w.inventory.install(await w.source("tts1", plugin("tts", "1.0.0", entry({provides: ["example.tts/voice"]})), {"main.js": ""}));
        await w.inventory.install(await w.source("reader", plugin("reader", "1.0.0", {...entry({requires: ["example.tts/voice"], provides: ["example.reader/text"]}), pluginVersions: {"example.tts": "^1.0.0"}}), {"main.js": ""}));
        await w.inventory.install(await w.source("panel", plugin("panel", "1.0.0", entry({requires: ["example.reader/text"]})), {"main.js": ""}));
        await w.inventory.install(await w.source("off", plugin("off", "1.0.0", {...entry({requires: ["example.tts/voice"]}), pluginVersions: {"example.tts": "^1.0.0"}}), {"main.js": ""}));
        await w.inventory.install(await w.source("broken", plugin("broken", "1.0.0"), {}));
        await w.restart();
        expect(await w.inventory.setEnabled("example.off", false)).toMatchObject({ok: true});
        await writeFile(join(w.root, "example.broken", "1.0.0", "package.json"), "{");

        const preview = await w.inventory.inspect(await w.source("tts2", plugin("tts", "2.0.0", entry({provides: ["example.tts/voice"]})), {"main.js": ""}));
        expect(preview).toEqual({ok: true, value: {
            id: "example.tts",
            version: "2.0.0",
            installed: "1.0.0",
            relation: "upgrade",
            blocked: [
                {plugin: "example.panel", entries: ["main"], reason: "provider-blocked"},
                {plugin: "example.reader", entries: ["main"], reason: "version-mismatch", range: "^1.0.0"},
            ],
            unchecked: ["example.broken"],
        }});
        // 范围接受的新版本：没有受阻的。
        expect(await w.inventory.inspect(await w.source("tts11", plugin("tts", "1.1.0", entry({provides: ["example.tts/voice"]})), {"main.js": ""}))).toMatchObject({ok: true, value: {blocked: []}});
        // 新版本不再提供、或挪到别的位置提供：依赖它的入口重启后缺服务。
        expect(await w.inventory.inspect(await w.source("tts12", plugin("tts", "1.2.0", entry({})), {"main.js": ""}))).toMatchObject({ok: true, value: {blocked: [
            {plugin: "example.panel", entries: ["main"], reason: "provider-blocked"},
            {plugin: "example.reader", entries: ["main"], reason: "missing-service", service: "example.tts/voice"},
        ]}});
        expect(await w.inventory.inspect(await w.source("tts13", plugin("tts", "1.3.0", {entries: {main: {location: "project", main: "main.js", provides: ["example.tts/voice"]}}}), {"main.js": ""}))).toMatchObject({ok: true, value: {blocked: [
            {plugin: "example.panel", entries: ["main"], reason: "provider-blocked"},
            {plugin: "example.reader", entries: ["main"], reason: "missing-service", service: "example.tts/voice"},
        ]}});
        // 已安装目录里的清单被换成别的插件：重启后它不登记，预览列为没核对，不拿它推导。
        await writeFile(join(w.root, "example.panel", "1.0.0", "package.json"), JSON.stringify(plugin("other", "1.0.0", entry({}))));
        expect(await w.inventory.inspect(await w.source("tts14", plugin("tts", "1.4.0", entry({provides: ["example.tts/voice"]})), {"main.js": ""}))).toMatchObject({ok: true, value: {blocked: [], unchecked: ["example.broken", "example.panel"]}});
        // 升级一个禁用的插件：重启后它仍禁用，依赖方前后一样，不列。
        expect(await w.inventory.inspect(await w.source("off2", plugin("off", "2.0.0", {...entry({requires: ["example.tts/voice"]}), pluginVersions: {"example.tts": "^9.0.0"}}), {"main.js": ""}))).toMatchObject({ok: true, value: {blocked: []}});
    });
});

