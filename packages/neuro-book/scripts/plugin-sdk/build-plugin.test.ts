/**
 * 构建预设（docs/specs/runtime/plugin-code-loading.md 输出 2、5，plugin-api.md 的“SDK”）：清单由代码定义生成并通过校验；
 * 每个入口一个文件、只导出 activate；浏览器产物登记工厂、只引用宿主模块表；样式包进 @layer components 并带上用到的图标；
 * 纯度检查按模块图拦下打包进来的 Vue、未共享的模块与绕过 SDK 的内核。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PLUGIN_REGISTRY_GLOBAL} from "../../src/shared/plugin-modules";
import {npmVersions} from "../../src/shared/versions";
import {buildExample, IN_REPO_BUILD} from "./build-examples";
import {buildPlugin, PluginBuildError} from "./build-plugin";

const repoModules = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));
let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-build", "build-plugin");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 在临时目录里写一个作者项目：`files` 是相对路径到内容；依赖链到仓库里同一份。 */
async function authorProject(name: string, files: Readonly<Record<string, string>>, extra: ReadonlyArray<string> = []): Promise<string> {
    const root = join(tmp, name);
    await mkdir(join(root, "node_modules/@vue"), {recursive: true});
    await mkdir(join(root, "node_modules/@notnotype"), {recursive: true});
    for (const item of ["vue", "typebox", ...extra]) await symlink(join(repoModules, item), join(root, "node_modules", item));
    for (const item of ["reactivity", "runtime-core", "runtime-dom", "shared"]) await symlink(join(repoModules, "@vue", item), join(root, "node_modules/@vue", item));
    await writeFile(join(root, "package.json"), JSON.stringify({publisher: "acme", name, version: "1.0.0", type: "module"}));
    await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.${name}", version: "1.0.0", locations: ["server", "browser"]};\n`);
    await writeAll(root, files);
    return root;
}

async function writeAll(root: string, files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), text);
    }
}

async function build(root: string) {
    return buildPlugin({root, outDir: join(root, "dist"), ...IN_REPO_BUILD});
}

async function failure(root: string): Promise<ReadonlyArray<string>> {
    try {
        await build(root);
    } catch (error) {
        if (error instanceof PluginBuildError) return error.problems.map((problem) => problem.message);
        throw error;
    }
    throw new Error("期望构建失败");
}

/** 像宿主那样执行浏览器产物：脚本登记工厂，工厂经 `require` 取宿主模块。 */
function registeredFactory(code: string): (module: {exports: Record<string, unknown>}, exports: Record<string, unknown>, require: (id: string) => unknown) => void {
    let factory: unknown = null;
    const scope = globalThis as Record<string, unknown>;
    scope[PLUGIN_REGISTRY_GLOBAL] = {register: (url: string, value: unknown) => {
        expect(url).toBe("http://plugin.test/browser.js");
        factory = value;
    }};
    scope.document = {currentScript: {src: "http://plugin.test/browser.js"}};
    try {
        new Function(code)();
    } finally {
        delete scope[PLUGIN_REGISTRY_GLOBAL];
        delete scope.document;
    }
    if (typeof factory !== "function") throw new Error("脚本没有登记工厂");
    return factory as never;
}

describe("构建示例 snippets", () => {
    it("清单由代码定义生成并通过校验；只有浏览器入口；样式包进 @layer components、带上分区与按钮的图标", async () => {
        const out = join(tmp, "snippets");
        const result = await buildExample("snippets", out);
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "style.css"]);
        const manifest = JSON.parse(await readFile(join(out, "package.json"), "utf8")) as Record<string, unknown>;
        const read = readPluginManifest(manifest, {versions: npmVersions});
        if (read.status !== "valid") throw new Error(JSON.stringify(read.problems));
        expect(read.manifest.id).toBe("example.snippets");
        expect(read.manifest.style).toBe("style.css");
        expect(read.manifest.entries.map((entry) => [entry.id, entry.location, entry.main, entry.activationEvents])).toEqual([["browser", "browser", "browser.js", ["onSettingsPage:example.snippets.main"]]]);
        expect(read.manifest.contributes.map((item) => item.id)).toEqual(["example.snippets/items"]);

        const style = await readFile(join(out, "style.css"), "utf8");
        expect(style.startsWith("@layer components {")).toBe(true);
        for (const icon of ["text-quote", "arrow-up", "arrow-down", "trash-2", "plus"]) expect(style).toContain(`.i-lucide-${icon} { --svg: url(`);
    }, 120_000);

    it("浏览器产物登记工厂；工厂只经宿主的 require 取共享模块，导出 activate", async () => {
        const code = await readFile(join(tmp, "snippets/browser.js"), "utf8");
        const factory = registeredFactory(code);
        // 宿主模块表里的真实模块。
        const table: Readonly<Record<string, unknown>> = {
            "vue": await import("vue"),
            "@vue/reactivity": await import("@vue/reactivity"),
            "@notnotype/nb-plugin-sdk": await import("../../src/sdk/index"),
            "@notnotype/nb-plugin-sdk/browser": await import("../../src/sdk/browser"),
            // nb-ui 的组件是单文件组件，Bun 加载不了；页面没有渲染，给一个空对象就够。
            "@notnotype/nb-ui/components": {},
        };
        const required: string[] = [];
        const module = {exports: {} as Record<string, unknown>};
        factory(module, module.exports, (id) => {
            required.push(id);
            if (!Object.hasOwn(table, id)) throw new Error(`表外模块 ${id}`);
            return table[id];
        });
        expect(typeof module.exports.activate).toBe("function");
        expect([...new Set(required)].every((id) => ["vue", "@vue/reactivity", "@notnotype/nb-ui/components", "@notnotype/nb-plugin-sdk", "@notnotype/nb-plugin-sdk/browser"].includes(id))).toBe(true);
        expect(code).toContain("//# sourceMappingURL=browser.js.map");
    }, 60_000);
});

describe("作者项目", () => {
    it("服务端入口是 ESM、只引用 SDK；远程合同写进清单；浏览器入口的定义模块静态导入 .vue 也能生成清单；typebox 打进产物", async () => {
        const root = await authorProject("echo", {
            "shared/contracts.ts": `import {defineRemoteService} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";
export const echoContract = defineRemoteService({id: "acme.echo/echo", version: 1, provider: "server", callers: ["browser"], methods: {say: {input: Type.Object({text: Type.String({maxLength: 100})}, {additionalProperties: false}), output: Type.String(), effect: "read"}}});
`,
            "backend/plugin.ts": `import {defineEntry, provideRemote} from "@notnotype/nb-plugin-sdk";
import {echoContract} from "../shared/contracts";
let calls = 0;
export const echoServer = {id: "acme.echo", entries: [defineEntry({id: "server", location: "server", remoteProvides: [echoContract], activate: () => ({remote: [provideRemote(echoContract, () => ({methods: {say: ({text}) => ({ok: true, value: text + String(++calls)})}}))]})})]};
`,
            "web/Panel.vue": `<script setup lang="ts">\nconst props = defineProps<{text: string}>();\n</script>\n<template><p class="echo-panel">{{ props.text }}</p></template>\n<style scoped>.echo-panel { color: var(--text-muted); }</style>\n`,
            "web/plugin.ts": `import {defineEntry} from "@notnotype/nb-plugin-sdk";
import Panel from "./Panel.vue";
import {echoContract} from "../shared/contracts";
export const panel = Panel;
export const echoBrowser = {id: "acme.echo", entries: [defineEntry({id: "browser", location: "browser", remoteDelegates: [echoContract], activate: () => ({})})]};
`,
        });
        const result = await build(root);
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "server.js", "server.js.map", "style.css"]);
        expect(Object.keys(result.manifest.contracts as object)).toEqual(["acme.echo/echo"]);
        const server = await readFile(join(root, "dist/server.js"), "utf8");
        expect([...server.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1])).toEqual(["@notnotype/nb-plugin-sdk"]);
        expect(server).toContain("export {");
        expect(await readFile(join(root, "dist/style.css"), "utf8")).toContain(".echo-panel[data-v-");
    }, 120_000);

    it("自带一份 Vue（经相对路径导入 node_modules 里的 vue）：构建失败，指出打进了 vue", async () => {
        const root = await authorProject("own-vue", {
            "web/plugin.ts": `import {ref} from "../node_modules/vue/dist/vue.runtime.esm-bundler.js";\nexport const p = {id: "acme.own-vue", entries: [{id: "browser", location: "browser", activate: () => { ref(0); return {}; }}]};\n`,
        });
        expect(await failure(root)).toEqual([expect.stringContaining("打进了 vue 的实现")]);
    }, 60_000);

    it("引用宿主没有共享的模块（nb-ui 的其它入口、@vue/shared、绕过 SDK 的内核）：构建失败，写明未共享", async () => {
        const root = await authorProject("unshared", {}, ["@notnotype/nb-ui", "@notnotype/nb-runtime"]);
        await writeAll(root, {
            "web/plugin.ts": `import {useNotification} from "@notnotype/nb-ui/notifications";\nimport {isArray} from "@vue/shared";\nexport const p = {id: "acme.unshared", entries: [{id: "browser", location: "browser", activate: () => { useNotification(); isArray([]); return {}; }}]};\n`,
            "backend/plugin.ts": `import {defineEntry} from "@notnotype/nb-runtime/plugins";\nexport const s = {id: "acme.unshared", entries: [defineEntry({id: "server", location: "server", activate: () => ({})})]};\n`,
        });
        const problems = await failure(root);
        for (const id of ["@notnotype/nb-ui/notifications", "@vue/shared", "@notnotype/nb-runtime/plugins"]) {
            expect(problems).toContainEqual(expect.stringContaining(`引用了宿主没有共享的模块 ${id}`));
        }
    }, 60_000);

    it("远程合同用了 Refine：构建前就失败，指出合同与方法", async () => {
        const root = await authorProject("refined", {
            "backend/plugin.ts": `import {defineEntry, defineRemoteService, provideRemote} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";
const contract = defineRemoteService({id: "acme.refined/x", version: 1, provider: "server", callers: ["browser"], methods: {get: {input: Type.Object({}, {additionalProperties: false}), output: Type.Refine(Type.String(), (value) => value.length > 0), effect: "read"}}});
export const s = {id: "acme.refined", entries: [defineEntry({id: "server", location: "server", remoteProvides: [contract], activate: () => ({remote: [provideRemote(contract, () => ({methods: {get: () => ({ok: true, value: "x"})}}))]})})]};
`,
        });
        let caught: unknown = null;
        try {
            await build(root);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PluginBuildError);
        expect((caught as PluginBuildError).problems).toContainEqual(expect.objectContaining({path: "contracts.acme.refined/x.methods.get.output", message: expect.stringContaining("Refine")}));
    }, 60_000);

    it("插件描述与 package.json 不一致、输出目录不是空的：构建失败", async () => {
        const root = await authorProject("mismatch", {"web/plugin.ts": "export const p = {id: \"acme.mismatch\", entries: []};\n"});
        await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.other", version: "1.0.0", locations: []};\n`);
        expect(await failure(root)).toEqual([expect.stringContaining("acme.other@1.0.0")]);
        await mkdir(join(root, "dist"), {recursive: true});
        await writeFile(join(root, "dist/left.txt"), "x");
        expect(await failure(root)).toEqual([join(root, "dist")]);
    }, 60_000);
});
