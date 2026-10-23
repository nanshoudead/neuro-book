/**
 * 第三方插件服务端与项目实例入口代码的装载（docs/specs/runtime/plugin-code-loading.md 输出 1、3、4）。
 *
 * - 宿主模块：第一次装载时用 Bun 的运行期插件把 `nbook/shared/plugin-modules` 的 `SERVER_SHARED_MODULES` 登记成虚拟模块，
 *   `exports` 是宿主自己导入的那一份（Vue 与 `@vue/reactivity` 只能有一份，见那张表的注释）。进程里只登记一次：再次登记会
 *   静默替换 exports。取不到时不缓存失败，下一次激活重新取。
 * - 表外的模块：Bun 的运行期插件看不到已装载模块里的静态导入（`onResolve` 只对宿主自己的 `import()` 生效），裸说明符会照
 *   Node 的规则沿安装目录向上找 `node_modules`，开发状态根在包目录里，几乎总能找到别的一份。所以对插件目录下的每个脚本在
 *   `onLoad` 里扫一遍导入：裸说明符不是共享模块、也不是 Node 与 Bun 的内置模块时抛 `ModuleNotShared`，装载器报成
 *   `module-not-shared`。按插件根目录（`<State Root>/plugins`）各登记一次，`filter` 只匹配那个目录，宿主自己的模块不经过它。
 * - 每次激活前删掉模块缓存里这个插件版本目录下的条目，再按固定路径 `import`：得到一份新的模块实例，模块顶层状态不跨代次；
 *   旧实例在宿主不再引用它交出的对象后可以回收。缓存的键是解析过符号链接的真实路径，版本目录先取 `realpath`。不用查询串：
 *   查询串也能得到新实例，但旧实例永不回收（docs/research/runtime-module-unloading.md）。
 * - 同一插件的几个入口不共享模块实例：删缓存按版本目录整个删，后激活的入口会重新执行先激活的入口也导入了的模块。这与构建
 *   预设的产物一致（每个入口打成一个文件，依赖各打一份）、与浏览器一致（每个入口一个登记工厂）；入口之间共享状态经服务。
 * - 例外：入口模块求值失败（顶层抛错、顶层 await reject）后，Bun 把失败记在模块记录里且不进 `require.cache`，删缓存删不到，
 *   再 `import` 原样拿到旧的失败。这时下一次装载给入口加查询串（`?attempt=<n>`）强制重新求值；失败的实例没有交出任何东西，
 *   不回收的代价只在失败路径上。入口相对导入的子模块求值失败时同样被缓存，查询串够不到它，要重启服务端。
 * - 以上都是 Bun 1.4.2 实测的行为，不是文档承诺，升级 Bun 时回归 `loader.test.ts`。
 * - 失败都抛 `PluginCodeError`，在入口的 `activate` 里抛出，内核按入口激活失败处理，只影响这个入口。
 */

import {builtinModules} from "node:module";
import {readFile, realpath, stat} from "node:fs/promises";
import {dirname, extname, join, relative, sep} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {descriptorOf} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";

import {errno} from "nbook/backend/locked-replace";
import {pluginsAt, thirdPartyDefinition, thirdPartyDefinitionAt} from "nbook/manifest";
import type {EntryLoader} from "nbook/manifest";
import {PluginCodeError} from "nbook/shared/plugin-code-error";
import {SERVER_SHARED_MODULES} from "nbook/shared/plugin-modules";

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
    }, (error: unknown) => {
        hostModules = null;
        throw error;
    });
    return hostModules;
}

/** 插件脚本导入了宿主模块表之外的裸说明符；由 `onLoad` 抛出，装载器换成带插件与入口的 `module-not-shared`。 */
class ModuleNotShared extends Error {
    readonly id: string;
    readonly importer: string;

    constructor(id: string, importer: string) {
        super(`引用了宿主没有共享的模块 ${id}`);
        this.id = id;
        this.importer = importer;
    }
}

const SHARED: ReadonlySet<string> = new Set(SERVER_SHARED_MODULES);
const BUILTIN: ReadonlySet<string> = new Set(builtinModules);
const SCRIPT_LOADERS: Readonly<Record<string, "js">> = {".js": "js", ".mjs": "js", ".cjs": "js"};

/** 能直接用的说明符：相对与绝对路径、共享模块、Node 与 Bun 的内置模块。 */
function allowedSpecifier(specifier: string): boolean {
    if (specifier.startsWith(".") || specifier.startsWith("/")) return true;
    if (specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:")) return true;
    return SHARED.has(specifier) || BUILTIN.has(specifier);
}

const guarded = new Set<string>();

/** 给一个插件根目录登记导入检查；同一目录只登记一次。 */
function guardPluginsDirectory(directory: string): void {
    if (guarded.has(directory)) return;
    guarded.add(directory);
    const escaped = `${directory}${sep}`.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
    Bun.plugin({
        name: `nbook-plugin-imports:${directory}`,
        setup(build) {
            build.onLoad({filter: new RegExp(`^${escaped}.*\\.(?:m?js|cjs)$`, "u")}, async (args) => {
                const contents = await readFile(args.path, "utf8");
                const loader = SCRIPT_LOADERS[extname(args.path)] ?? "js";
                for (const item of new Bun.Transpiler({loader}).scanImports(contents)) {
                    if (!allowedSpecifier(item.path)) throw new ModuleNotShared(item.path, args.path);
                }
                return {contents, loader};
            });
        },
    });
}

/** 入口求值失败过的次数，按入口文件的真实路径：下一次装载用查询串强制重新求值（见文件头注释）。 */
const failedEvaluations = new Map<string, number>();

/** 一个已安装插件的入口装载器：交给 `thirdPartyDefinitionAt`。 */
export function serverEntryLoader(plugin: InstalledPlugin): EntryLoader {
    return async (entry) => {
        const at = {plugin: plugin.id, entry: entry.id, url: entry.main};
        try {
            await registerHostModules();
        } catch (error) {
            throw new PluginCodeError("code-load-failed", {...at, detail: `装载不了：宿主模块没有取到（${error instanceof Error ? error.message : String(error)}）`, cause: error});
        }
        let root: string;
        let file: string;
        try {
            root = await realpath(plugin.root);
            file = join(root, entry.main);
            if (!(await stat(file)).isFile()) throw new PluginCodeError("code-load-failed", {...at, detail: "不是普通文件"});
        } catch (error) {
            if (error instanceof PluginCodeError) throw error;
            const code = errno(error);
            const detail = code === "ENOENT" || code === "ENOTDIR" ? "的文件不存在" : `的文件读不了（${code ?? "未知错误"}）`;
            throw new PluginCodeError("code-load-failed", {...at, detail, cause: error});
        }
        // 版本目录是 `<插件根目录>/<插件 id>/<版本>`。
        guardPluginsDirectory(dirname(dirname(root)));
        const prefix = root + sep;
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(prefix)) delete require.cache[key];
        }
        const attempt = failedEvaluations.get(file) ?? 0;
        let module: Record<string, unknown>;
        try {
            module = (await import(attempt === 0 ? file : `${file}?attempt=${String(attempt)}`)) as Record<string, unknown>;
        } catch (error) {
            if (error instanceof ModuleNotShared) {
                throw new PluginCodeError("module-not-shared", {...at, detail: `${error.message}（由 ${relative(root, error.importer)} 引入）`, cause: error});
            }
            if (errno(error) === "ERR_MODULE_NOT_FOUND") {
                throw new PluginCodeError("code-load-failed", {...at, detail: `导入的文件不存在：${error instanceof Error ? error.message : String(error)}`, cause: error});
            }
            failedEvaluations.set(file, attempt + 1);
            throw new PluginCodeError("code-threw", {...at, detail: `装载时出错：${error instanceof Error ? error.message : String(error)}`, cause: error});
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
