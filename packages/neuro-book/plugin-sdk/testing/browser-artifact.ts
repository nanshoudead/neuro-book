/**
 * 像宿主那样执行浏览器产物：经真实的装载器（`createPluginCodeHost`）把产物插进共用的假页面（`src/plugin-platform/testing/fake-page.ts`），
 * 取得脚本登记的工厂，再用宿主模块表执行它。构建预设与生成的 SDK 包的测试共用，判断“产物只经宿主的 require 取共享模块”
 * 看执行时真的取了什么，不读压缩后的源码。
 */

import {NEUROBOOK_PROFILE} from "../../src/plugin-platform-profile";
import type {BrowserSharedModule} from "../../src/plugin-platform-profile";
import {fakePage} from "../../src/plugin-platform/testing/fake-page";
import type {ModuleFactory} from "../../src/plugin-platform/testing/fake-page";
import {createPluginCodeHost} from "../../src/plugin-platform/web/plugin-code";

/**
 * 浏览器一侧宿主模块表里的真实模块，键按共享名单（`BrowserSharedModule`）写全，名单变了这里编译不过。nb-ui 的组件是单文件
 * 组件，Bun 加载不了；产物在这里不渲染，组件入口给一个空对象。
 */
export async function browserHostModules(): Promise<Readonly<Record<BrowserSharedModule, unknown>>> {
    const modules: Record<BrowserSharedModule, () => Promise<unknown>> = {
        "vue": () => import("vue"),
        "@vue/reactivity": () => import("@vue/reactivity"),
        "typebox": () => import("typebox"),
        "typebox/value": () => import("typebox/value"),
        "typebox/compile": () => import("typebox/compile"),
        "@notnotype/nb-plugin-sdk": () => import("../../src/sdk/index"),
        "@notnotype/nb-plugin-sdk/state": () => import("../../src/sdk/state"),
        "@notnotype/nb-plugin-sdk/storage": () => import("../../src/sdk/storage"),
        "@notnotype/nb-plugin-sdk/settings": () => import("../../src/sdk/settings"),
        "@notnotype/nb-plugin-sdk/settings/browser": () => import("../../src/sdk/settings-browser"),
        "@notnotype/nb-plugin-sdk/commands": () => import("../../src/sdk/commands"),
        "@notnotype/nb-plugin-sdk/workbench": () => import("../../src/sdk/workbench"),
        "@notnotype/nb-plugin-sdk/components": async () => ({}),
    };
    return Object.fromEntries(await Promise.all(Object.entries(modules).map(async ([id, load]) => [id, await load()]))) as Record<BrowserSharedModule, unknown>;
}

/**
 * 装载浏览器产物，返回脚本登记的工厂。装载器自己用宿主模块表执行一次工厂并核对导出了 `activate`；工厂本身经全局登记对象的
 * 等待取得：同一 URL 的每个等待者都收到登记，这里与装载器一样是一个等待者，不写那个全局属性。每次一个新页面，产物的基址是
 * 那个页面的目录。
 */
export async function registeredFactory(code: string): Promise<ModuleFactory> {
    const page = fakePage(NEUROBOOK_PROFILE.registryGlobal);
    page.serve("browser.js", {kind: "runs", code});
    const host = createPluginCodeHost({document: page.document, registryGlobal: NEUROBOOK_PROFILE.registryGlobal, modules: browserHostModules});
    const registry = (globalThis as unknown as Record<string, {wait(url: string, waiter: (factory: unknown) => void): () => void}>)[NEUROBOOK_PROFILE.registryGlobal]!;
    let factory: unknown = null;
    const stop = registry.wait(new URL("browser.js", page.baseURI).href, (registered) => {
        factory = registered;
    });
    try {
        await host.activateOf({plugin: "acme.test", entry: "browser", url: "browser.js", signal: new AbortController().signal});
    } finally {
        stop();
    }
    if (typeof factory !== "function") throw new Error("脚本没有登记工厂");
    return factory as ModuleFactory;
}

/**
 * 用宿主模块表执行一次工厂：返回模块的导出与经 require 取过的模块（按取的先后，可重复）；取表外的模块抛错。只看得到工厂
 * 执行期间的 require：构建产物把外部模块的 require 提到模块顶层，`activate` 里懒取的模块要调了 `activate` 才记得到。
 * 引用了不共享的模块，构建预设自己的纯度检查先拦下（plugin-code-loading 输出 5）。
 */
export async function runFactory(factory: ModuleFactory): Promise<{readonly exports: Record<string, unknown>; readonly required: ReadonlyArray<string>}> {
    const table = await browserHostModules();
    const required: string[] = [];
    const module = {exports: {} as Record<string, unknown>};
    factory(module, module.exports, (id) => {
        required.push(id);
        if (!Object.hasOwn(table, id)) throw new Error(`表外模块 ${id}`);
        return (table as Readonly<Record<string, unknown>>)[id];
    });
    return {exports: module.exports, required};
}
