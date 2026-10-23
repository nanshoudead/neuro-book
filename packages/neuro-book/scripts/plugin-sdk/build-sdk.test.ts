/**
 * 生成的 SDK 包能在仓库外使用（docs/specs/runtime/plugin-api.md 的“SDK”）：装进一个只有 vue、typebox 与 TypeScript
 * 的作者项目，普通 tsconfig 下类型检查通过（不跳过库文件），构建期实现能执行；类型导出的名字钉住，增删要改这里。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {cp, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildSdk} from "./build-sdk";

const repoModules = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));
let tmp = "";
let project = "";

/** 作者的插件源码：两端的入口、设置项、page 分区与宿主能力都从 SDK 取。 */
const AUTHOR_SOURCE = `import {defineEntry, defineSetting, defineStore, hostClockKey, SETTINGS_PAGES_POINT, settingsKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition, PluginDescriptor} from "@notnotype/nb-plugin-sdk";
import {settingsPageContribution} from "@notnotype/nb-plugin-sdk/browser";
import {Type} from "typebox";

export const greeting = defineSetting({plugin: "acme.hello", name: "greeting", schema: Type.String(), default: "hi", title: {"zh-CN": "问候", "en-US": "Greeting"}, layers: ["user"], applies: "now"});
export const descriptor: PluginDescriptor = {id: "acme.hello", version: "1.0.0", locations: ["server", "browser"], contributions: [greeting.contribution]};
const page = settingsPageContribution({id: "acme.hello.main", declaration: {title: {"zh-CN": "你好", "en-US": "Hello"}, category: "plugins", icon: "i-lucide-smile"}, load: async () => ({default: {}})});
export const counter = defineStore("counter", () => ({state: {count: 0}, actions: {}}));
export const plugin: PluginDefinition = {
    id: "acme.hello",
    entries: [
        defineEntry({id: "server", location: "server", dependencies: [{key: hostClockKey}], activate: (context) => {
            const now: number = context.services.require(hostClockKey).now();
            void now;
            return {};
        }}),
        defineEntry({id: "browser", location: "browser", activationEvents: [page.activationEvent], dependencies: [{key: settingsKey}], contributions: [page.contribution], activate: () => ({contributions: {[SETTINGS_PAGES_POINT]: {[page.id]: page.implementation()}}})}),
    ],
};
`;

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
    await buildSdk(join(tmp, "sdk"));
    await mkdir(join(project, "node_modules/@vue"), {recursive: true});
    await mkdir(join(project, "src"), {recursive: true});
    await cp(join(tmp, "sdk"), sdk, {recursive: true});
    // 作者项目自己装的包：peer 依赖与 TypeScript。直接链到仓库里同一份，不联网安装。
    for (const name of ["vue", "typebox", "typescript", "csstype"]) await symlink(join(repoModules, name), join(project, "node_modules", name));
    for (const name of ["reactivity", "runtime-core", "runtime-dom", "shared", "compiler-dom", "compiler-core", "compiler-sfc", "compiler-ssr", "server-renderer"]) {
        await symlink(join(repoModules, "@vue", name), join(project, "node_modules/@vue", name));
    }
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: false, lib: ["ESNext", "DOM"]}, include: ["src"]}));
    await writeFile(join(project, "src/plugin.ts"), AUTHOR_SOURCE);
}, 120_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("生成的 SDK 包", () => {
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
});
