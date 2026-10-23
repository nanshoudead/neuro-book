/**
 * 生成的 SDK 包能在仓库外使用（docs/specs/runtime/plugin-api.md 的“SDK”）：装进一个只有 vue、typebox 与 TypeScript
 * 的作者项目，普通 tsconfig 下类型检查通过（不跳过库文件），构建预设的类型也能用，构建期实现能执行；类型导出的名字钉住，
 * 增删要改这里。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {cp, mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {npmVersions} from "../../src/shared/versions";

import {buildSdk} from "./build-sdk";

const repoModules = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));
let tmp = "";
let project = "";

/** 作者的插件源码：两端的入口、设置项、page 分区与宿主能力都从 SDK 取；服务端与浏览器的入口分模块写（服务端产物不能带浏览器的 SDK）。 */
const AUTHOR_SOURCES: Readonly<Record<string, string>> = {
    "src/shared.ts": `import {defineSetting} from "@notnotype/nb-plugin-sdk";
import type {PluginDescriptor} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

export const greeting = defineSetting({plugin: "acme.hello", name: "greeting", schema: Type.String(), default: "hi", title: {"zh-CN": "问候", "en-US": "Greeting"}, layers: ["user"], applies: "now"});
export const descriptor: PluginDescriptor = {id: "acme.hello", version: "1.0.0", locations: ["server", "browser"], contributions: [greeting.contribution]};
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
    "src/web.ts": `import {defineEntry, SETTINGS_PAGES_POINT, settingsKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {settingsPageContribution} from "@notnotype/nb-plugin-sdk/browser";

const page = settingsPageContribution({id: "acme.hello.main", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, category: "plugins", icon: "i-lucide-smile"}, load: async () => ({default: {}})});
export const browser: PluginDefinition = {id: "acme.hello", entries: [defineEntry({id: "browser", location: "browser", activationEvents: [page.activationEvent], dependencies: [{key: settingsKey}], contributions: [page.contribution], activate: () => ({contributions: {[SETTINGS_PAGES_POINT]: {[page.id]: page.implementation()}}})})]};
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

/** `.d.ts` 末尾 `export {…}` 里导出的名字（`a as b` 取 b，去掉 `type`）。 */
function declaredExports(text: string): string[] {
    const list = /export \{([^}]*)\};?\s*$/u.exec(text.trimEnd())?.[1];
    if (list === undefined) throw new Error("声明文件末尾没有 export 列表");
    return list.split(",").map((item) => item.trim().replace(/^type /u, "").split(" as ").at(-1)!.trim()).filter((name) => name !== "").sort();
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "build-sdk");
    project = join(tmp, "author");
    const sdk = join(project, "node_modules/@notnotype/nb-plugin-sdk");
    // 输出目录里是上次生成的 SDK 包：清空重建，旧文件不留。
    await mkdir(join(tmp, "sdk"), {recursive: true});
    await writeFile(join(tmp, "sdk/package.json"), JSON.stringify({name: "@notnotype/nb-plugin-sdk", version: "0.0.0"}));
    await writeFile(join(tmp, "sdk/stale.js"), "");
    await buildSdk(join(tmp, "sdk"));
    await mkdir(join(project, "node_modules/@vue"), {recursive: true});
    await mkdir(join(project, "src"), {recursive: true});
    await cp(join(tmp, "sdk"), sdk, {recursive: true});
    // 作者项目自己装的包：peer 依赖、TypeScript 与构建预设的依赖。直接链到仓库里同一份，不联网安装。
    await mkdir(join(project, "node_modules/@vitejs"), {recursive: true});
    await mkdir(join(project, "node_modules/@iconify"), {recursive: true});
    await mkdir(join(project, "node_modules/@iconify-json"), {recursive: true});
    for (const name of ["vue", "typebox", "typescript", "csstype", "vite", "semver", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide"]) {
        await symlink(join(repoModules, name), join(project, "node_modules", name));
    }
    for (const name of ["reactivity", "runtime-core", "runtime-dom", "shared", "compiler-dom", "compiler-core", "compiler-sfc", "compiler-ssr", "server-renderer"]) {
        await symlink(join(repoModules, "@vue", name), join(project, "node_modules/@vue", name));
    }
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: false, lib: ["ESNext", "DOM"]}, include: ["src"]}));
    for (const [path, text] of Object.entries(AUTHOR_SOURCES)) await writeFile(join(project, path), text);
    await writeFile(join(project, "package.json"), JSON.stringify({publisher: "acme", name: "hello", version: "1.0.0", type: "module", nbook: {definitions: ["src/backend.ts", "src/web.ts"]}}));
    await writeFile(join(project, "plugin.ts"), `export {descriptor} from "./src/shared";\n`);
}, 120_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("生成的 SDK 包", () => {
    it("peer 依赖是 vue、@vue/reactivity（与 vue 同一范围，两者成对发布）与 typebox；./build 带类型；上次生成的旧文件已清掉", async () => {
        const manifest = JSON.parse(await readFile(join(tmp, "sdk/package.json"), "utf8")) as {peerDependencies: Record<string, string>; exports: Record<string, Record<string, string>>};
        expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@vue/reactivity", "typebox", "vue"]);
        expect(manifest.peerDependencies["@vue/reactivity"]).toBe(manifest.peerDependencies.vue!);
        expect(manifest.exports["./build"]).toEqual({types: "./build.d.ts", import: "./build.js"});
        expect(await readdir(join(tmp, "sdk"))).not.toContain("stale.js");
    });

    it("输出目录不是空的、也不是上次生成的 SDK 包：拒绝，不删里面的文件", async () => {
        const other = join(tmp, "not-sdk");
        await mkdir(other, {recursive: true});
        await writeFile(join(other, "package.json"), JSON.stringify({name: "my-project"}));
        await expect(buildSdk(other)).rejects.toThrow("不清理");
        expect(await readdir(other)).toEqual(["package.json"]);
    });

    it("仓库外的作者项目用普通 tsconfig 类型检查通过，声明文件本身也检查（不跳过库文件）", async () => {
        const result = Bun.spawnSync({cmd: [process.execPath, join(project, "node_modules/typescript/bin/tsc"), "-p", project], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
        expect(result.exitCode).toBe(0);
    }, 60_000);

    it("声明文件写错的地方会被类型检查拦下：page 分区少了必填的 icon", async () => {
        await writeFile(join(project, "src/wrong.ts"), `import {settingsPageContribution} from "@notnotype/nb-plugin-sdk/browser";\nsettingsPageContribution({id: "x", declaration: {title: {"zh-CN": "x", "en-US": "x"}, category: "plugins"}, load: async () => ({default: {}})});\n`);
        try {
            const result = Bun.spawnSync({cmd: [process.execPath, join(project, "node_modules/typescript/bin/tsc"), "-p", project], cwd: project, stdout: "pipe"});
            expect(result.stdout.toString()).toContain("'icon'");
        } finally {
            await rm(join(project, "src/wrong.ts"));
        }
    }, 60_000);

    it("构建期实现能在作者项目里执行，运行时导出与源码的导出面相同", async () => {
        const probe = join(project, "probe.mjs");
        await writeFile(probe, `const index = await import("@notnotype/nb-plugin-sdk");\nconsole.log(JSON.stringify(Object.keys(index).sort()));\n`);
        const result = Bun.spawnSync({cmd: ["node", probe], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(result.stderr.toString()).toBe("");
        expect(JSON.parse(result.stdout.toString())).toEqual(Object.keys(await import("../../src/sdk/index")).sort());
    }, 60_000);

    it("类型导出的名字", async () => {
        expect(declaredExports(await readFile(join(project, "node_modules/@notnotype/nb-plugin-sdk/index.d.ts"), "utf8"))).toEqual([
            "ActivationContext", "COMMANDS_POINT", "CommandDeclaration", "CommandImplementation", "ContributionDeclaration", "ContributionDescriptor",
            "ContributionHandle", "ContributionPointDefinition", "ContributionReceiver", "DiagnosticsService", "DisplayLocale", "LocalizedText",
            "PluginDefinition", "PluginDescriptor", "PluginEntryDefinition", "RecordDefinition", "RecordHandle", "RemoteContract", "RemoteOutcome",
            "RemoteResult", "RemoteSink", "RuntimeClock", "SETTINGS_PAGES_POINT", "ServiceKey", "SettingDefinition", "SettingLayer", "SettingWriteResult",
            "SettingsFailure", "SettingsPageDeclaration", "SettingsService", "StateRoot", "StorageService", "defineEntry", "definePublicState",
            "defineRecord", "defineRemoteService", "defineServiceKey", "defineSetting", "defineStore", "diagnosticsKey", "displayLocale", "formatText",
            "hostClockKey", "hostStateRootKey", "localize", "orThrow", "provide", "providePerConsumer", "provideRemote", "settingsKey", "settingsPageEvent",
            "storageKey",
        ].sort());
        expect(declaredExports(await readFile(join(project, "node_modules/@notnotype/nb-plugin-sdk/browser.d.ts"), "utf8"))).toEqual([
            "SettingsPageActions", "SettingsPageContext", "SettingsPageContribution", "SettingsPageList", "SettingsRow", "SettingsSaveBar", "settingsPage",
            "settingsPageContribution",
        ].sort());
    });

    it("仓库外用生成的包里的构建预设构建插件：清单合格，产物只引用宿主共享的模块", async () => {
        const {buildPlugin} = await import(join(project, "node_modules/@notnotype/nb-plugin-sdk/build.js")) as typeof import("./build-plugin");
        const out = join(tmp, "hello-dist");
        const result = await buildPlugin({root: project, outDir: out});
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "server.js", "server.js.map", "style.css"]);
        const manifest = readPluginManifest(JSON.parse(await readFile(join(out, "package.json"), "utf8")), {versions: npmVersions});
        if (manifest.status !== "valid") throw new Error(JSON.stringify(manifest.problems));
        expect(manifest.manifest.entries.map((entry) => entry.id)).toEqual(["server", "browser"]);
        expect(manifest.manifest.contributes.map((item) => item.id)).toEqual(["acme.hello/greeting"]);
        // 浏览器产物压缩过，工厂的 require 参数改了名：从登记外壳里取出它的名字，再找对它的调用。这里不执行产物，执行要
        // 写宿主的全局登记对象（build-plugin.test.ts 经装载器做）。
        const browser = await readFile(join(out, "browser.js"), "utf8");
        const requireName = /register\([\w$]+,\s*function\s*\([\w$]+,\s*[\w$]+,\s*([\w$]+)\)/u.exec(browser)?.[1];
        if (requireName === undefined) throw new Error("产物里没有登记外壳");
        const required = [...browser.matchAll(new RegExp(`(?<![\\w$.])${requireName.replaceAll("$", "\\$")}\\(["'\`]([^"'\`]+)["'\`]\\)`, "gu"))].map((match) => match[1]);
        expect([...new Set(required)].sort()).toEqual(["@notnotype/nb-plugin-sdk", "@notnotype/nb-plugin-sdk/browser"]);
    }, 120_000);
});

