/**
 * 生成的 SDK 包能在仓库外使用（docs/specs/runtime/plugin-api.md 的“SDK”）：装进一个只有 vue、typebox、TypeScript 与
 * vue-tsc 的作者项目，普通 tsconfig 下类型检查通过（不跳过库文件，含单文件组件里用的 SDK 组件），构建预设的类型也能用，
 * 构建期实现能执行；类型导出的名字钉住，增删要改这里。作者文档、附表与它引用的 Spec 随包，包里 Markdown 的相对链接都打得开。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {manifestFormat} from "../src/plugin-platform-profile";

import {AUTHOR_PACKAGES} from "./dependencies";
import {buildSdk, clearPreviousSdk} from "./pack";
import type {BuiltSdk} from "./pack";
import {authorDirectory} from "./testing/author";
import {registeredFactory, runFactory} from "./testing/browser-artifact";
import {builtSdk} from "./testing/sdk";

let tmp = "";
let project = "";
let built: BuiltSdk;
/** 作者项目里装好的 SDK 包（从 tarball 解开的）。 */
let installed = "";

/** 作者的插件源码：两端的入口、设置项、page 分区与宿主能力都从 SDK 取；服务端与浏览器的入口分模块写（服务端产物不能带浏览器的 SDK）。 */
const AUTHOR_SOURCES: Readonly<Record<string, string>> = {
    "src/shared.ts": `import {defineSetting, SETTINGS_SECTIONS_POINT} from "@notnotype/nb-plugin-sdk";
import type {ContributionDeclaration, PluginDescriptor, SettingsSectionDeclaration} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

export const greeting = defineSetting({plugin: "acme.hello", name: "greeting", schema: Type.String(), default: "hi", title: {"zh-CN": "问候", "en-US": "Greeting"}, layers: ["user"], applies: "now"});
// list 分区：顶层声明，写错字段在编译期就报。
const section: ContributionDeclaration<SettingsSectionDeclaration> = {capability: SETTINGS_SECTIONS_POINT, id: "acme.hello.list", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, icon: "i-lucide-smile", category: "plugins", groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}]}};
// @ts-expect-error list 分区没有 layout（那是 page 分区的字段）。
export const wrong: SettingsSectionDeclaration = {title: {"zh-CN": "错", "en-US": "Wrong"}, icon: "i-lucide-x", category: "plugins", layout: "fill"};
export const descriptor: PluginDescriptor = {id: "acme.hello", version: "1.0.0", locations: ["server", "browser"], contributions: [greeting.contribution, section]};
`,
    "src/backend.ts": `import {defineEntry, defineStore, hostClockKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition} from "@notnotype/nb-plugin-sdk";

export const counter = defineStore("counter", () => ({state: {count: 0}, actions: {}}));
export const server: PluginDefinition = {id: "acme.hello", entries: [defineEntry({id: "server", location: "server", dependencies: [{key: hostClockKey}], activate: (context) => {
    const now: number = context.services.require(hostClockKey).now();
    void now;
    return {};
}})]};
`,
    "src/web.ts": `import {defineEntry, SETTINGS_CHOICES_POINT, SETTINGS_PAGES_POINT, settingsChoicesEvent, settingsKey, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "@notnotype/nb-plugin-sdk";
import type {ContributionDeclaration, ItemDeclaration, PluginDefinition, SettingsChoicesDeclaration} from "@notnotype/nb-plugin-sdk";
import {settingsPageContribution, viewContribution} from "@notnotype/nb-plugin-sdk/browser";
import type {ItemImplementation, OptionSource, SettingsChoicesImplementation} from "@notnotype/nb-plugin-sdk/browser";
// 静态导入单文件组件：构建预设读入口定义时会执行到它对 SDK 组件的导入，组件的构建期实现要在 SDK 包里。
import HelloView from "./HelloView.vue";

const view = viewContribution({id: "acme.hello.panel", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, icon: "i-lucide-smile", location: "sidebar", layout: "scroll"}, load: async () => HelloView});

const page = settingsPageContribution({id: "acme.hello.main", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, category: "plugins", icon: "i-lucide-smile"}, load: async () => ({default: {}})});
// 选项来源：给设置项的下拉列表供数据。
const voices: ContributionDeclaration<SettingsChoicesDeclaration> = {capability: SETTINGS_CHOICES_POINT, id: "acme.hello.voices", declaration: {}};
const options = (): OptionSource<string> => ({status: "ready", items: [{value: "calm", label: {"zh-CN": "平静", "en-US": "Calm"}}]});
const choices: SettingsChoicesImplementation = {source: options};
// 状态栏条目按作者文档（README.md）的标准写法：声明是纯数据，实现是几个函数。
const status: ItemDeclaration = {title: {"zh-CN": "你好", "en-US": "Hello"}, alignment: "right", order: 100, priority: 0, command: {id: "acme.hello.say"}};
const item: ItemImplementation = {text: () => "hi", tooltip: () => "hello", state: () => "normal"};
export const browser: PluginDefinition = {id: "acme.hello", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup", page.activationEvent, settingsChoicesEvent(voices.id)], dependencies: [{key: settingsKey}], contributions: [page.contribution, voices, view.contribution, {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: "acme.hello.status", declaration: status}], activate: () => ({contributions: {[SETTINGS_PAGES_POINT]: {[page.id]: page.implementation()}, [SETTINGS_CHOICES_POINT]: {[voices.id]: choices}, [WORKBENCH_VIEWS_POINT]: {[view.id]: view.implementation(() => ({greeting: "hi"}))}, [WORKBENCH_STATUSBAR_ITEMS_POINT]: {"acme.hello.status": item}}})})]};
`,
    "src/HelloView.vue": `<script setup lang="ts">
import {Button} from "@notnotype/nb-plugin-sdk/components";
import type {ViewContext} from "@notnotype/nb-plugin-sdk/browser";

const props = defineProps<{context: ViewContext; greeting: string}>();
</script>

<template>
    <div class="hello"><Button variant="primary">{{ props.greeting }}</Button><span>{{ props.context.id }}</span></div>
</template>

<style scoped>
.hello {
    padding: var(--space-4);
}
</style>
`,
    // 作者自己的构建脚本：用构建预设的类型，不是入口定义（不在 nbook.definitions 里）。
    "src/build.ts": `import {buildPlugin, PluginBuildError} from "@notnotype/nb-plugin-sdk/build";
import type {BuildPluginOptions, BuildPluginResult} from "@notnotype/nb-plugin-sdk/build";

const options: BuildPluginOptions = {root: ".", outDir: "dist", alias: [{find: /^~\\//u, replacement: "./src/"}]};
export async function run(): Promise<BuildPluginResult | ReadonlyArray<string>> {
    try {
        return await buildPlugin(options);
    } catch (error) {
        if (error instanceof PluginBuildError) return error.problems.map((problem) => \`\${problem.path}：\${problem.message}\`);
        throw error;
    }
}
`,
};

/** Markdown 行内链接里的相对路径（去掉锚点并解码）；绝对地址与页内锚点不算。 */
function relativeLinks(markdown: string): string[] {
    return [...markdown.matchAll(/\]\(([^()\s]+)\)/gu)]
        .map((match) => match[1]!)
        .filter((url) => !/^[a-z][a-z0-9+.-]*:/iu.test(url) && !url.startsWith("#"))
        .map((url) => decodeURIComponent(url.split("#", 1)[0]!));
}

/** `.d.ts` 末尾 `export {…}` 里导出的名字（`a as b` 取 b，去掉 `type`）。 */
function declaredExports(text: string): string[] {
    const list = /export \{([^}]*)\};?\s*$/u.exec(text.trimEnd())?.[1];
    if (list === undefined) throw new Error("声明文件末尾没有 export 列表");
    return list.split(",").map((item) => item.trim().replace(/^type /u, "").split(" as ").at(-1)!.trim()).filter((name) => name !== "").sort();
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "pack");
    built = await builtSdk();
    // 作者项目：装上 SDK 的 tarball 与作者机器上要有的包（peer 依赖、TypeScript 与构建预设的依赖，链到仓库里同一份，不联网）。
    project = await authorDirectory(join(tmp, "author"), built.tarball);
    installed = join(project, "node_modules/@notnotype/nb-plugin-sdk");
    await mkdir(join(project, "src"), {recursive: true});
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: false, lib: ["ES2020", "DOM"]}, include: ["src"]}));
    for (const [path, text] of Object.entries(AUTHOR_SOURCES)) await writeFile(join(project, path), text);
    await writeFile(join(project, "package.json"), JSON.stringify({publisher: "acme", name: "hello", version: "1.0.0", type: "module", nbook: {definitions: ["src/backend.ts", "src/web.ts"]}}));
    await writeFile(join(project, "plugin.ts"), `export {descriptor} from "./src/shared";\n`);
}, 240_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("生成的 SDK 包", () => {
    it("peer 依赖是 vue、@vue/reactivity（与 vue 同一范围，两者成对发布）与 typebox；./build 带类型", async () => {
        const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as {peerDependencies: Record<string, string>; exports: Record<string, Record<string, string>>};
        expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@vue/reactivity", "typebox", "vue"]);
        expect(manifest.peerDependencies["@vue/reactivity"]).toBe(manifest.peerDependencies.vue!);
        expect(manifest.exports["./build"]).toEqual({types: "./build.d.ts", import: "./build.js"});
    });

    it("tarball 里有示例插件的源码与模板（含 `_gitignore`）；不带场景测试、场地、测试文件与构建产物；模板的开发依赖带上作者项目自己装的包", async () => {
        const files = (await readdir(installed, {recursive: true})).map((file) => file.split("\\").join("/"));
        expect(files).toEqual(expect.arrayContaining(["examples/plugins/focus/plugin.ts", "examples/plugins/focus/web/FocusPanel.vue", "examples/external/declarative/package.json", "template/_gitignore", "template/_package.json"]));
        expect(files.filter((file) => file.startsWith("examples/") && (/^examples\/(scenarios|testing)\//u.test(file) || file.endsWith(".test.ts") || file.split("/").includes("dist")))).toEqual([]);
        const template = JSON.parse(await readFile(join(installed, "template/_package.json"), "utf8")) as {devDependencies: Record<string, string>};
        expect(Object.keys(template.devDependencies).sort()).toEqual(["@notnotype/nb-plugin-sdk", ...AUTHOR_PACKAGES].sort());
        expect(Object.values(template.devDependencies).filter((range) => range.includes("__") && range !== "^__SDK_VERSION__")).toEqual([]);
    });

    it("输出目录是上次生成的 SDK 包：清空，旧文件不留", async () => {
        const previous = join(tmp, "previous");
        await mkdir(previous, {recursive: true});
        await writeFile(join(previous, "package.json"), JSON.stringify({name: "@notnotype/nb-plugin-sdk", version: "0.0.0"}));
        await writeFile(join(previous, "stale.js"), "");
        await clearPreviousSdk(previous);
        expect(existsSync(previous)).toBe(false);
    });

    it("带作者文档、组件与主题变量两份附表和作者文档引用的 Spec；包里 Markdown 的相对链接都能打开，指向包外的改成文字", async () => {
        const sdk = installed;
        expect(await readFile(join(sdk, "docs/components.md"), "utf8")).toContain("`Button`");
        const tokens = await readFile(join(sdk, "docs/tokens.md"), "utf8");
        expect(tokens).toContain("`--space-2`");
        expect(tokens).toContain("`--accent-main`");
        // 仓库里的作者文档指向 docs/specs/ 的每一份 Spec，包里都有副本。
        const sourceReadme = fileURLToPath(new URL("./README.md", import.meta.url));
        const specsRoot = fileURLToPath(new URL("../../../docs/specs/", import.meta.url));
        const referenced = [...new Set(relativeLinks(await readFile(sourceReadme, "utf8")).map((url) => relative(specsRoot, resolve(dirname(sourceReadme), url))))];
        expect(referenced.length).toBeGreaterThan(0);
        expect(referenced.filter((spec) => !existsSync(join(sdk, "specs", spec)))).toEqual([]);
        // 包里的 README 不指向包外：作者装的包里只有这些文件。
        const links = relativeLinks(await readFile(join(sdk, "README.md"), "utf8"));
        expect(links.length).toBe(relativeLinks(await readFile(sourceReadme, "utf8")).length);
        expect(links.filter((url) => relative(sdk, resolve(sdk, url)).startsWith("..") || !existsSync(resolve(sdk, url)))).toEqual([]);
        // Spec 副本里指向没随包的文档的链接改成文字：包里的链接都打得开，包外的那份写明在仓库里的路径。
        const broken: string[] = [];
        for (const file of await readdir(join(sdk, "specs"), {recursive: true})) {
            if (!file.endsWith(".md")) continue;
            const text = await readFile(join(sdk, "specs", file), "utf8");
            for (const url of relativeLinks(text)) {
                const target = resolve(dirname(join(sdk, "specs", file)), url);
                if (relative(sdk, target).startsWith("..") || !existsSync(target)) broken.push(`${file} → ${url}`);
            }
        }
        expect(broken).toEqual([]);
        expect(await readFile(join(sdk, "specs/runtime/plugin-api.md"), "utf8")).toContain("（仓库里的 `docs/adr/");
    });

    it("输出目录不是空的、也不是上次生成的 SDK 包：拒绝，不删里面的文件", async () => {
        const other = join(tmp, "not-sdk");
        await mkdir(other, {recursive: true});
        await writeFile(join(other, "package.json"), JSON.stringify({name: "my-project"}));
        await expect(buildSdk(other)).rejects.toThrow("不清理");
        expect(await readdir(other)).toEqual(["package.json"]);
    });

    it("仓库外的作者项目用普通 tsconfig 类型检查通过，声明文件本身也检查（不跳过库文件），单文件组件里的 SDK 组件有类型", async () => {
        const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
        expect(result.exitCode).toBe(0);
    }, 60_000);

    it("声明文件写错的地方会被类型检查拦下：page 分区少了必填的 icon", async () => {
        await writeFile(join(project, "src/wrong.ts"), `import {settingsPageContribution} from "@notnotype/nb-plugin-sdk/browser";\nsettingsPageContribution({id: "x", declaration: {title: {"zh-CN": "x", "en-US": "x"}, category: "plugins"}, load: async () => ({default: {}})});\n`);
        try {
            const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project], cwd: project, stdout: "pipe"});
            expect(result.stdout.toString()).toContain("'icon'");
        } finally {
            await rm(join(project, "src/wrong.ts"));
        }
    }, 60_000);

    it("作者 API 的入口写错时，类型检查的诊断写明是哪一项：漏写、多写、浏览器助手写进服务端入口、视图属性名写错", async () => {
        await writeFile(join(project, "src/wrong-entry.ts"), `import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {view} from "@notnotype/nb-plugin-sdk/browser";
import HelloView from "./HelloView.vue";
const plugin = definePlugin({id: "acme.hello", version: "1.0.0", locations: ["server", "browser"]});
const say = plugin.command({name: "say", title: "x", description: "x", effect: "write"});
const ping = plugin.command({name: "ping", title: "x", description: "x", effect: "read"});
const panel = view(plugin, {name: "panel", title: "x", icon: "i-lucide-x", load: async () => HelloView});
const lazyPanel = view(plugin, {name: "lazy", title: "x", icon: "i-lucide-x", load: () => import("./HelloView.vue")});
export const missing = plugin.entry({location: "server", contributions: {say, ping}, activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null}))}})});
export const extra = plugin.entry({location: "server", contributions: {say}, activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null})), surplus: ping.implement(() => ({ok: true, value: null}))}})});
export const misplaced = plugin.entry({location: "server", contributions: {panel}, activate: () => ({contributions: {panel: panel.implement()}})});
export const props = lazyPanel.implement(() => ({greting: "hi"}));
`);
        try {
            const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project, "--pretty", "false"], cwd: project, stdout: "pipe"});
            // 一条诊断是“文件(行,列): error …”一行，加上它下面缩进的说明链。
            const diagnostics = result.stdout.toString().split(/\n(?=\S)/u);
            const at = (row: number): string => diagnostics.filter((text) => text.startsWith(`src/wrong-entry.ts(${String(row)},`)).join("\n");
            expect(at(9)).toContain("'ping'");
            expect(at(10)).toContain("多写的贡献实现：surplus");
            expect(at(11)).toContain("只能写进浏览器入口：panel");
            expect(at(12)).toContain("greting");
        } finally {
            await rm(join(project, "src/wrong-entry.ts"));
        }
    }, 60_000);

    it("构建期实现能在作者项目里执行，运行时导出与源码的导出面相同", async () => {
        const probe = join(project, "probe.mjs");
        await writeFile(probe, `const index = await import("@notnotype/nb-plugin-sdk");\nconsole.log(JSON.stringify(Object.keys(index).sort()));\n`);
        const result = Bun.spawnSync({cmd: ["node", probe], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(result.stderr.toString()).toBe("");
        expect(JSON.parse(result.stdout.toString())).toEqual(Object.keys(await import("../src/sdk/index")).sort());
    }, 60_000);

    it("类型导出的名字", async () => {
        expect(declaredExports(await readFile(join(installed, "index.d.ts"), "utf8"))).toEqual([
            "ActivationContext", "AuthorActivationContext", "AuthorEntry", "AuthorEntryOutput", "BoundImplementation", "COMMANDS_POINT", "CommandHelper", "CommandResult", "ContributionHelper", "PluginBuilder", "SectionHelper", "Text", "definePlugin", "CommandDeclaration", "CommandImplementation", "ContributionDeclaration", "ContributionDescriptor",
            "ContributionHandle", "ContributionPointDefinition", "ContributionReceiver", "DiagnosticsService", "DisplayLocale", "LocalizedText",
            "PluginDefinition", "PluginDescriptor", "PluginEntryDefinition", "RecordDefinition", "RecordHandle", "RecordSnapshot", "RemoteContract", "RemoteOutcome",
            "RemoteResult", "RemoteSink", "RemoteSubscribeOptions", "RemoteSubscription", "Revision", "RuntimeClock", "SETTINGS_CHOICES_POINT", "SETTINGS_PAGES_POINT", "SETTINGS_SECTIONS_POINT", "ServiceKey", "SettingDefinition", "SettingLayer", "SettingWriteResult",
            "SettingsChoicesDeclaration", "SettingsFailure", "SettingsPageDeclaration", "SettingsSectionCategory", "SettingsSectionDeclaration", "SettingsService", "StateRoot", "StorageFailure", "StorageService", "defineEntry", "definePublicState",
            "defineRecord", "defineRemoteService", "defineServiceKey", "defineSetting", "defineStore", "diagnosticsKey", "displayLocale", "formatText",
            "fail", "hostClockKey", "hostStateRootKey", "localize", "ok", "orThrow", "provideService", "provideServicePerConsumer", "provideRemote", "settingsChoicesEvent", "settingsKey",
            "storageKey", "ItemDeclaration", "ViewDeclaration", "ViewLocation", "WORKBENCH_STATUSBAR_ITEMS_POINT", "WORKBENCH_VIEWS_POINT", "WriteResult",
        ].sort());
        expect(declaredExports(await readFile(join(installed, "browser.d.ts"), "utf8"))).toEqual([
            "ChoicesHelper", "PropsOf", "SettingsPageHelper", "StatusItemHelper", "ViewHelper", "choices", "settingsPage", "statusItem", "view",
            "OptionSource", "SettingsChoicesImplementation", "SettingsPageActions", "SettingsPageContext", "SettingsPageContribution", "SettingsPageList", "SettingsRow", "SettingsSaveBar",
            "settingsPageContribution", "ItemImplementation", "ViewContext", "ViewContribution", "ViewImplementation", "viewContribution",
        ].sort());
        // 组件子路径的声明与源码里逐个列出的名单一致：nb-ui 入口里别的导出不会混进来。
        const listed = [...(await readFile(fileURLToPath(new URL("../src/sdk/components.ts", import.meta.url)), "utf8")).matchAll(/export (?:type )?\{([^}]+)\}/gu)].flatMap((match) => match[1]!.split(",").map((name) => name.trim()).filter((name) => name !== ""));
        expect(declaredExports(await readFile(join(installed, "components.d.ts"), "utf8"))).toEqual([...listed].sort());
    });

    it("仓库外用生成的包里的构建预设构建插件：清单合格，产物只引用宿主共享的模块", async () => {
        const {buildPlugin} = await import(join(installed, "build.js")) as typeof import("./build");
        const out = join(tmp, "hello-dist");
        const result = await buildPlugin({root: project, outDir: out});
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "server.js", "server.js.map", "style.css"]);
        const manifest = manifestFormat.read(JSON.parse(await readFile(join(out, "package.json"), "utf8")));
        if (manifest.status !== "valid") throw new Error(JSON.stringify(manifest.problems));
        expect(manifest.manifest.entries.map((entry) => entry.id)).toEqual(["server", "browser"]);
        expect(manifest.manifest.contributes.map((item) => item.id)).toEqual(["acme.hello/greeting", "acme.hello.list"]);
        // 像宿主那样执行浏览器产物，看工厂经 require 真的取了哪些模块。
        const {required} = await runFactory(await registeredFactory(await readFile(join(out, "browser.js"), "utf8")));
        // 单文件组件编译后引用 vue。
        expect([...new Set(required)].sort()).toEqual(["@notnotype/nb-plugin-sdk", "@notnotype/nb-plugin-sdk/browser", "@notnotype/nb-plugin-sdk/components", "vue"]);
    }, 120_000);
});

