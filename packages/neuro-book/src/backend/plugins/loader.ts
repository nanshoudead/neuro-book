/**
 * 第三方插件服务端与项目实例入口代码的装载（docs/specs/runtime/plugin-code-loading.md 输出 1、3、4）。
 *
 * - 宿主模块：第一次装载时用 Bun 的运行期插件把 `nbook/shared/plugin-modules` 的 `SERVER_SHARED_MODULES` 登记成虚拟模块，
 *   `exports` 是宿主自己导入的那一份（Vue 与 `@vue/reactivity` 只能有一份，见那张表的注释）。进程里只登记一次：再次登记会
 *   静默替换 exports。
 * - 每次激活前删掉模块缓存里这个插件版本目录下的条目，再按固定路径 `import`：得到一份新的模块实例，模块顶层状态不跨代次；
 *   旧实例在宿主不再引用它交出的对象后可以回收。不用查询串：查询串也能得到新实例，但旧实例永不回收
 *   （docs/research/runtime-module-unloading.md）。这两样都是 Bun 1.4.2 实测的行为，不是文档承诺，升级 Bun 时回归 `loader.test.ts`。
 * - 失败都抛 `PluginCodeError`，在入口的 `activate` 里抛出，内核按入口激活失败处理，只影响这个入口。
 */

import {lstat} from "node:fs/promises";
import {join, sep} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {descriptorOf} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";

import {pluginsAt, thirdPartyDefinition, thirdPartyDefinitionAt} from "nbook/manifest";
import type {EntryLoader} from "nbook/manifest";
import {PluginCodeError} from "nbook/shared/plugin-code-error";
import type {SERVER_SHARED_MODULES} from "nbook/shared/plugin-modules";

import {manifestOfInstalled} from "./installed";
import type {InstalledPlugin} from "./installed";

let hostModules: Promise<void> | null = null;

/** 宿主模块的实现：动态导入，没有第三方入口的进程不必加载它们。 */
async function serverHostModules(): Promise<Readonly<Record<(typeof SERVER_SHARED_MODULES)[number], object>>> {
    const [reactivity, sdk] = await Promise.all([import("@vue/reactivity"), import("nbook/sdk/index")]);
    return {"@vue/reactivity": reactivity, "@notnotype/nb-plugin-sdk": sdk};
}

function registerHostModules(): Promise<void> {
    hostModules ??= serverHostModules().then((table) => {
        Bun.plugin({
            name: "nbook-plugin-host-modules",
            setup(build) {
                for (const [id, exports] of Object.entries(table)) build.module(id, () => ({exports: exports as Record<string, unknown>, loader: "object"}));
            },
        });
    });
    return hostModules;
}

/** 一个已安装插件的入口装载器：交给 `thirdPartyDefinitionAt`。 */
export function serverEntryLoader(plugin: InstalledPlugin): EntryLoader {
    return async (entry) => {
        await registerHostModules();
        const at = {plugin: plugin.id, entry: entry.id, url: entry.main};
        const file = join(plugin.root, entry.main);
        try {
            if (!(await lstat(file)).isFile()) throw new PluginCodeError("code-load-failed", {...at, detail: "不是普通文件"});
        } catch (error) {
            if (error instanceof PluginCodeError) throw error;
            throw new PluginCodeError("code-load-failed", {...at, detail: "的文件不存在或读不了"});
        }
        const prefix = plugin.root + sep;
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(prefix)) delete require.cache[key];
        }
        let module: Record<string, unknown>;
        try {
            module = (await import(file)) as Record<string, unknown>;
        } catch (error) {
            throw new PluginCodeError("code-threw", {...at, detail: `装载时出错：${error instanceof Error ? error.message : String(error)}`});
        }
        const activate = module.activate;
        if (typeof activate !== "function") throw new PluginCodeError("code-shape", {...at, detail: "没有导出 activate"});
        return activate as Awaited<ReturnType<EntryLoader>>;
    };
}

/**
 * 服务端或项目实例登记的第三方插件定义：本位置有入口的、或有顶层声明式贡献的插件（`pluginsAt`），入口激活时经本文件的
 * 装载器取回代码。清单引用的内置合同从本位置的内置插件定义里找。清单读不了（服务端与接收方的校验规则不一致）或引用了
 * 本位置不认识的合同时，跳过它或只登记它的顶层声明，并记诊断：一个插件出错不挡实例启动。
 */
export function thirdPartyDefinitionsAt(
    location: "server" | "project",
    installed: ReadonlyArray<InstalledPlugin>,
    builtin: ReadonlyArray<PluginDefinition>,
    record: (input: DiagnosticInput) => void,
): PluginDefinition[] {
    const contracts = new Map<string, RemoteContract>();
    for (const definition of builtin) {
        for (const entry of definition.entries) {
            for (const contract of [...(entry.remoteProvides ?? []), ...(entry.remoteDelegates ?? [])]) contracts.set(contract.id, contract);
        }
    }
    const definitions: PluginDefinition[] = [];
    for (const plugin of installed) {
        const read = manifestOfInstalled(plugin);
        if (!read.ok) {
            record({level: "warn", event: "plugins.startup.manifest-unreadable", message: `第三方插件 ${plugin.id} 的清单读不了，不登记`, data: {plugin: plugin.id, detail: read.detail}});
            continue;
        }
        const descriptor = descriptorOf(read.manifest);
        if (pluginsAt(location, [descriptor]).length === 0) continue;
        try {
            definitions.push(thirdPartyDefinitionAt(location, read.manifest, {
                load: serverEntryLoader(plugin),
                contractOf: (id) => {
                    const contract = contracts.get(id);
                    if (contract === undefined) throw new Error(`引用了本位置没有的合同 ${id}`);
                    return contract;
                },
            }));
        } catch (error) {
            record({level: "warn", event: "plugins.startup.unregistrable", message: `第三方插件 ${plugin.id} 的入口登记不了，只登记它的顶层声明`, error, data: {plugin: plugin.id}});
            definitions.push(thirdPartyDefinition(descriptor));
        }
    }
    return definitions;
}
