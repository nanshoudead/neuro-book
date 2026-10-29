/**
 * 第三方插件经 SDK 取界面文字（docs/specs/ui/i18n.md 输出 4、验收 5，docs/specs/runtime/plugin-api.md 的“SDK”）：生成 SDK 包的
 * tarball，在仓库外的作者目录里装上它，写一个改写自 `examples/plugins/snippets` 的插件（自带 `locales/*.json`，组件从
 * `/text/browser` 取 `usePluginText`、`useText`，从 `/text` 取 `pluginText`），用包里的命令构建；产物经真实的装载器与窗口用的
 * 宿主模块表执行，组件挂在注入了宿主翻译引擎的根上。切换界面语言后，组件里的文字原位换成另一种语言。
 *
 * 失败方式：插件拿到的 `useText` 不是宿主那一份（注入键不同，取不到端口，`useText()` 抛错）；产物把 SDK 的文字子路径打进了
 * 自己（`required` 里没有它）；目录没随产物走或文字不随语言更新（断言的文字不变）。
 *
 * 目录这里按产物的清单（`l10n.source`）与 `dist/locales/` 登记进引擎，与窗口登记第三方目录的结果相同；窗口经真实服务端取
 * 目录的那条路径由 `src/web/host/window-catalogs.test.ts` 负责。生成 SDK 包与构建要 Bun，这里起子进程运行。
 */

import {spawn} from "node:child_process";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {flushPromises, mount} from "@vue/test-utils";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import type {Component} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {provideText} from "nbook/shared/testing/text-port";
import {hostModules} from "nbook/web/host/plugin-modules";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {authorDirectory, cliOf} from "./testing/author";
import {registeredFactory, runFactory} from "./testing/browser-artifact";

// 不写成 `new URL("..", import.meta.url)`：happy-dom 环境里 Vitest 把它改写成 http 地址。
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "acme.snippets";

/** 作者的插件：结构照模板（`plugin.ts`、`shared/`、`web/`），界面是片段列表的一小段。 */
const AUTHOR_SOURCES: Readonly<Record<string, string>> = {
    "shared/contracts.ts": `import {definePlugin} from "@notnotype/nb-plugin-sdk";

export const plugin = definePlugin({id: "${PLUGIN}", version: "1.0.0", locations: ["browser"]});
`,
    "plugin.ts": `import {plugin} from "./shared/contracts";

export const descriptor = plugin.descriptor([]);
`,
    // 视图不写标题：登记时补成约定键 views.list.title，目录里有这一项。
    "web/plugin.ts": `import {view} from "@notnotype/nb-plugin-sdk/workbench";

import {plugin} from "../shared/contracts";
import SnippetsList from "./SnippetsList.vue";

const list = view(plugin, {name: "list", icon: "i-lucide-text-quote", load: async () => SnippetsList});

export const browserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    contributions: {list},
    activate: () => ({contributions: {list: list.implement()}}),
})]);
`,
    "web/SnippetsList.vue": `<script setup lang="ts">
import {ref} from "vue";

import {Button} from "@notnotype/nb-plugin-sdk/components";
import {pluginText} from "@notnotype/nb-plugin-sdk/text";
import {usePluginText, useText} from "@notnotype/nb-plugin-sdk/text/browser";
import type {ViewContext} from "@notnotype/nb-plugin-sdk/workbench";

import {plugin} from "../shared/contracts";

defineProps<{context: ViewContext}>();

type Source = typeof import("../locales/zh-CN.json");
const text = usePluginText<Source>(plugin.id);
const port = useText();
const count = pluginText<Source>(plugin.id);
const items = ref<string[]>([]);
</script>

<template>
    <div data-snippets>
        <p v-if="items.length === 0" data-snippets-empty>{{ text("editor.empty") }}</p>
        <p data-snippets-count>{{ port.t(count("editor.count", {count: items.length})) }}</p>
        <Button data-snippets-add @click="items.push(text('editor.newName'))">{{ text("editor.add") }}</Button>
    </div>
</template>
`,
    "locales/zh-CN.json": `${JSON.stringify({views: {list: {title: "常用片段"}}, editor: {empty: "还没有片段", add: "添加片段", newName: "新片段", count_other: "共 {{count}} 条"}}, null, 2)}\n`,
    "locales/en-US.json": `${JSON.stringify({views: {list: {title: "Snippets"}}, editor: {empty: "No snippets yet", add: "Add Snippet", newName: "New Snippet", count_one: "{{count}} snippet", count_other: "{{count}} snippets"}}, null, 2)}\n`,
};

let tmp = "";
let dist = "";

/** 运行命令，失败时带上全部输出抛错；成功时返回标准输出（同 `e2e/plugin-authoring.e2e.ts`）。 */
async function run(command: string, args: ReadonlyArray<string>, cwd: string): Promise<string> {
    const child = spawn(command, args, {cwd, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number>((resolve) => child.on("exit", (exit) => resolve(exit ?? 1)));
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} 失败：\n${output}`);
    return stdout;
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "third-party-text");
    // 生成 SDK 包（命令最后一行打印 tarball 的路径），装进仓库外的作者目录，用包里的命令构建。
    const tarball = (await run("bun", ["plugin-sdk/pack.ts", join(tmp, "sdk")], PACKAGE_ROOT)).trim().split("\n").at(-1)!;
    const author = await authorDirectory(join(tmp, "snippets"), tarball);
    for (const [path, text] of Object.entries(AUTHOR_SOURCES)) {
        await mkdir(dirname(join(author, path)), {recursive: true});
        await writeFile(join(author, path), text);
    }
    const manifest = JSON.parse(await readFile(join(author, "package.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(author, "package.json"), JSON.stringify({...manifest, publisher: "acme", name: "snippets", version: "1.0.0", type: "module", l10n: {source: "zh-CN"}}));
    await run("bun", [cliOf(author), "build"], author);
    dist = join(author, "dist");
}, 240_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 按产物清单的 `l10n` 读 `dist/locales/`，登记进一个宿主引擎（命名空间是插件 id）。 */
async function engineWithCatalogs() {
    const manifest = JSON.parse(await readFile(join(dist, "package.json"), "utf8")) as {l10n: {source: string; locales: ReadonlyArray<string>}};
    const catalogs = Object.fromEntries(await Promise.all(manifest.l10n.locales.map(async (locale) => [locale, JSON.parse(await readFile(join(dist, "locales", `${locale}.json`), "utf8")) as unknown])));
    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    engine.register(PLUGIN, catalogs as Parameters<typeof engine.register>[1], manifest.l10n.source);
    return engine;
}

describe("第三方插件的界面文字", () => {
    it("组件经 SDK 的文字入口取到宿主的翻译端口，翻的是插件自己随产物的目录；切换界面语言后原位换文字，组件状态不丢", async () => {
        const modules = async () => hostModules();
        const {exports, required} = await runFactory(await registeredFactory(await readFile(join(dist, "browser.js"), "utf8"), modules), modules);
        // 文字入口是宿主模块表里的共享模块，不打进产物。
        expect(required).toEqual(expect.arrayContaining(["@notnotype/nb-plugin-sdk/text", "@notnotype/nb-plugin-sdk/text/browser"]));
        // 作者入口的 `activate` 把实现按贡献点归好：`{contributions: {<贡献点>: {<贡献 id>: 实现}}}`。
        const activate = exports.activate as (context: unknown) => Promise<{contributions: Record<string, Record<string, {load(): Promise<Component>}>>}>;
        const view = Object.values((await activate({})).contributions)
            .flatMap((implementations) => Object.entries(implementations))
            .find(([id]) => id === `${PLUGIN}.list`)?.[1];
        expect(view).toBeDefined();
        const Loaded = await view!.load();

        const engine = await engineWithCatalogs();
        const wrapper = mount(defineComponent({render: () => h(Loaded, {context: {id: `view:${PLUGIN}.list`}})}), {global: {provide: provideText(engine.port)}, attachTo: document.body});
        await flushPromises();
        const textOf = (selector: string): string | undefined => wrapper.find(selector).element.textContent?.trim();
        expect(textOf("[data-snippets-empty]")).toBe("还没有片段");
        expect(textOf("[data-snippets-count]")).toBe("共 0 条");
        expect(textOf("[data-snippets-add]")).toBe("添加片段");

        await wrapper.find("[data-snippets-add]").trigger("click");
        await flushPromises();
        expect(wrapper.find("[data-snippets-empty]").exists()).toBe(false);
        expect(textOf("[data-snippets-count]")).toBe("共 1 条");
        const button = wrapper.find("[data-snippets-add]").element;

        engine.setLocale("en-US");
        await flushPromises();
        // 带参数与复数的那条按英文的复数规则取 `_one`；加过的一条还在（没有重新挂载）。
        expect(textOf("[data-snippets-count]")).toBe("1 snippet");
        expect(textOf("[data-snippets-add]")).toBe("Add Snippet");
        expect(wrapper.find("[data-snippets-add]").element).toBe(button);
        wrapper.unmount();
    }, 60_000);
});
