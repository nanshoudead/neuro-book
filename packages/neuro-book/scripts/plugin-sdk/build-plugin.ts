/**
 * 第三方插件的构建预设（docs/specs/runtime/plugin-api.md 的“SDK”、plugin-code-loading.md 输出 2–5）：把作者目录构建成
 * 可以安装的插件目录。
 *
 * 作者合同：
 * - `package.json` 给 `publisher`、`name`、`version`，可选 `description`、`license`、`engines.neurobook`（缺省取
 *   `^<产品版本>`）、`pluginVersions`，以及 `nbook.definitions`（入口定义模块，缺省 `backend/plugin.ts`、`web/plugin.ts`
 *   里存在的）；
 * - `plugin.ts` 导出插件描述 `descriptor`，id 是 `<publisher>.<name>`、版本与 `package.json` 相同；
 * - 每个入口定义模块导出一个或多个 `PluginDefinition`，与内置插件同一写法。模块顶层会在构建时执行一次（为了读出声明）。
 *
 * 产物：
 * - `package.json`：作者的字段加上由代码定义生成的清单（NeuroBook 清单格式的 `build`，生成即校验）；
 * - 每个入口一个文件 `<入口 id>.js`（带 source map，`sources` 是相对作者目录的路径），只导出 `activate`，声明以清单为准。
 *   服务端与项目入口是 ESM；浏览器入口包成登记工厂并压缩，脚本执行时调用宿主的 `register`，每次激活宿主调用一次工厂。
 *   插件自己的动态导入都内联进这个文件，共享模块的动态导入在浏览器产物里也经工厂的 `require` 取；
 * - `style.css`：各入口的样式合并后包进 `@layer components`，加上插件用到的 Lucide 图标的规则（宿主只为自己源码里出现过的
 *   图标类生成规则）。
 *
 * 共享模块（平台档案 `src/plugin-platform-profile.ts` 的两张表）留作外部引用；纯度检查按打包器的模块图核对：打进了宿主那一份 Vue（`vue`、
 * `@vue/reactivity`、`@vue/runtime-*`）、nb-ui 或 SDK 的实现就失败，外部引用（静态与动态导入）不在宿主模块表里也失败
 * （“未共享”），两件事都在构建时报出。
 */

import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile} from "node:fs/promises";
import {builtinModules, createRequire} from "node:module";
import {stripVTControlCharacters} from "node:util";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";

import type {ManifestProblem, ManifestSource} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {getIconData, iconToHTML, iconToSVG, svgToURL} from "@iconify/utils";
import vue from "@vitejs/plugin-vue";
import * as compiler from "vue/compiler-sfc";
import {build as vite, createServer} from "vite";
import type {Plugin} from "vite";

import {PRODUCT_VERSION} from "../../src/shared/product";
import {BROWSER_SHARED_MODULES, manifestFormat, NEUROBOOK_PROFILE, SERVER_SHARED_MODULES} from "../../src/plugin-platform-profile";

const DEFAULT_DEFINITIONS = ["backend/plugin.ts", "web/plugin.ts"];
const BUILT_LOCATIONS = ["server", "project", "browser"] as const;
type BuiltLocation = (typeof BUILT_LOCATIONS)[number];

/**
 * 必须用宿主那一份的 Vue 包：它们带响应式状态与组件实例，打进第二份就和宿主互相看不见。其它 `@vue/*`（`@vue/shared`、
 * `@vue/devtools-api` 这类无状态的工具包，vue-router、Pinia 都依赖后者）照常打进插件。
 */
const HOST_VUE_PACKAGES = ["vue", "@vue/reactivity", "@vue/runtime-core", "@vue/runtime-dom"];
/**
 * 由宿主提供、不许打进产物的包：打进去会出现第二份（第二份 Vue、第二份内核）。它们（含子路径）的引用一律留作外部，再按
 * 模块表判断能不能用；经相对路径之类绕过包名、解析到它们目录里的模块，就是打进了第二份。
 */
const HOST_PACKAGES = [...HOST_VUE_PACKAGES, "@notnotype/nb-ui", "@notnotype/nb-plugin-sdk", "@notnotype/nb-runtime"];
const ALWAYS_EXTERNAL = HOST_PACKAGES.map((name) => new RegExp(`^${name.replaceAll("/", "\\/")}($|\\/)`, "u"));
/** 从 `vue` 再导出的包：引用改写成外部的 `vue`，与宿主是同一份（依赖里的库常直接引用它们）。 */
const VUE_REEXPORTED = /^@vue\/runtime-(?:core|dom)$/u;

/**
 * 解析别名，Vite `resolve.alias` 写法的子集。不直接用 Vite 的类型：生成的 SDK 包里 `./build` 的声明文件引用了它，作者的
 * 构建脚本做类型检查时就要连带检查 Vite 的声明（还要装 Node 的类型）。
 */
export interface BuildAlias {
    readonly find: string | RegExp;
    readonly replacement: string;
}

export interface BuildPluginOptions {
    /** 作者目录：含 `package.json` 与 `plugin.ts`。 */
    readonly root: string;
    /** 输出目录：不存在或为空。 */
    readonly outDir: string;
    /** 额外的解析别名。仓库里的示例把 SDK 指到应用源码；仓库外的作者不用。 */
    readonly alias?: ReadonlyArray<BuildAlias>;
    /** 另外不许打进产物的目录。仓库里是应用源码：SDK 的别名指到那里，打进去就是第二份 SDK。 */
    readonly forbiddenDirectories?: ReadonlyArray<string>;
    /**
     * 写进产物清单的版本，缺省是作者的 `version`。作者工具的 `--dev` 用它给每次构建一个带构建元数据的新版本，在插件页
     * 安装时按升级处理（docs/specs/runtime/plugin-api.md 的“作者工具”）。
     */
    readonly version?: string;
}

export interface BuildPluginResult {
    /** 写进 `package.json` 的清单。 */
    readonly manifest: Record<string, unknown>;
    /** 相对输出目录的文件。 */
    readonly files: ReadonlyArray<string>;
    /** 不让构建失败、但作者该知道的事（例如源码里写了不存在的图标）。 */
    readonly warnings: ReadonlyArray<string>;
}

/** 构建失败：`problems` 逐条列出原因，路径是清单字段或源码模块。 */
export class PluginBuildError extends Error {
    /** 一句话的原因，不含逐条问题。 */
    readonly summary: string;
    readonly problems: ReadonlyArray<ManifestProblem>;

    // 不写成 `ErrorOptions`：它是 ES2022 的库类型，生成的 `./build` 声明文件会要求作者的 `lib` 至少是 ES2022。
    constructor(summary: string, problems: ReadonlyArray<ManifestProblem>, options?: {readonly cause?: unknown}) {
        super(`${summary}：${problems.map((problem) => (problem.path === "" ? problem.message : `${problem.path}：${problem.message}`)).join("；")}`, options);
        this.name = "PluginBuildError";
        this.summary = summary;
        this.problems = problems;
    }
}

interface AuthorPackage {
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly license?: string;
    readonly engines?: Readonly<Record<string, string>>;
    readonly pluginVersions?: Readonly<Record<string, string>>;
    readonly nbook?: {readonly definitions?: ReadonlyArray<string>};
}

interface LocatedEntry {
    readonly entry: PluginEntryDefinition;
    readonly location: BuiltLocation;
    /** 定义这个入口的模块（绝对路径）。 */
    readonly module: string;
}

/** 一次构建里打包器看到的事实，供纯度检查与图标扫描。 */
interface BundleFacts {
    readonly modules: string[];
    /** 外部引用（静态与动态导入）到引入它的第一个模块；引入者不明时为 null。 */
    readonly externals: Map<string, string | null>;
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
    return typeof value === "object" && value !== null && typeof (value as {id?: unknown}).id === "string" && Array.isArray((value as {entries?: unknown}).entries);
}

async function readAuthor(root: string): Promise<AuthorPackage> {
    const file = join(root, "package.json");
    let raw: unknown;
    try {
        raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        throw new PluginBuildError("读不了插件目录的 package.json", [{path: "package.json", message: `${file}：${error instanceof Error ? error.message : String(error)}`}], {cause: error});
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new PluginBuildError("插件目录的 package.json 不是对象", [{path: "package.json", message: file}]);
    const record = raw as Partial<Record<keyof AuthorPackage, unknown>>;
    const problems: ManifestProblem[] = [];
    for (const field of ["publisher", "name", "version"] as const) {
        if (typeof record[field] !== "string" || record[field] === "") problems.push({path: field, message: "package.json 必须写这个字段"});
    }
    if (problems.length > 0) throw new PluginBuildError("插件目录的 package.json 不完整", problems);
    return raw as AuthorPackage;
}

/**
 * 单文件组件的编译。编译器直接交给插件：模块执行环境（`runnerImport`）里插件不会自己去找 `vue/compiler-sfc`，按作者目录
 * 也不一定找得到（作者项目里的 vue 只是 peer 依赖）。
 */
function vuePlugin(): Plugin {
    return vue({compiler});
}

/**
 * 执行描述与入口定义模块，只读声明、不调用 `activate`。用一个不监听端口的 Vite 开发服务的 SSR 加载：它与产物构建同一套
 * 插件与别名，能加载 `.vue` 与 TypeScript。关掉依赖发现：发现进行中时 `close()` 不结算。关掉 WebSocket 服务：中间件模式
 * 下 `hmr: false` 也仍会监听固定的 HMR 端口，同一台机器上并行构建时端口被占，报错打到输出里。
 */
async function loadModules(root: string, alias: ReadonlyArray<BuildAlias>, files: ReadonlyArray<string>): Promise<Array<Record<string, unknown>>> {
    const server = await createServer({
        configFile: false,
        root,
        logLevel: "error",
        appType: "custom",
        plugins: [vuePlugin()],
        resolve: {alias: [...alias]},
        server: {middlewareMode: true, hmr: false, ws: false, watch: null},
        optimizeDeps: {noDiscovery: true, include: []},
    });
    try {
        const loaded: Array<Record<string, unknown>> = [];
        for (const file of files) {
            try {
                loaded.push(await server.ssrLoadModule(file));
            } catch (error) {
                throw new PluginBuildError("执行入口定义失败", [{path: relative(root, file), message: error instanceof Error ? error.message : String(error)}]);
            }
        }
        return loaded;
    } finally {
        await server.close();
    }
}

/**
 * 作者项目里装的包的根目录（真实路径）；没有这个包时为 null。按 Node 的办法逐级找 `node_modules/<包名>`，不用
 * `require.resolve`：Bun 的解析会套用 tsconfig 的路径别名，仓库里会把 SDK 解析进应用源码。
 */
async function packageRoot(fromRoot: string, name: string): Promise<string | null> {
    for (let directory = fromRoot; ; directory = dirname(directory)) {
        const candidate = join(directory, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) return realpath(candidate);
        if (dirname(directory) === directory) return null;
    }
}

function isNodeBuiltin(specifier: string): boolean {
    return specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:") || builtinModules.includes(specifier);
}

function within(file: string, directory: string): boolean {
    const path = relative(directory, file);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** `@vue/runtime-core`、`@vue/runtime-dom` 的引用改成外部的 `vue`。在 `external` 判断之后、解析时改写：别名做不到。 */
function vueRuntimePlugin(): Plugin {
    return {
        name: "nbook-plugin-vue-runtime",
        enforce: "pre",
        resolveId: (id) => (VUE_REEXPORTED.test(id) ? {id: "vue", external: true} : null),
    };
}

/**
 * 记下打包器的模块图：打进了哪些模块、留下了哪些外部引用、各是谁引入的。外部引用从打进来的每个模块的导入里找：Rolldown
 * 输出块的 `imports`、`dynamicImports` 不列外部模块的动态导入，外部模块的 `getModuleInfo` 也不带 `importers`（1.1 实测）。
 * 磁盘上的模块（打进来的，和没用到而被摇掉的）id 是绝对路径，`\0` 开头的是虚拟模块；剩下的说明符就是外部引用。
 */
function factsPlugin(facts: BundleFacts): Plugin {
    return {
        name: "nbook-plugin-facts",
        generateBundle(_options, bundle) {
            const record = (id: string, importer: string | null): void => {
                if (!isAbsolute(id) && !id.startsWith("\0") && !Object.hasOwn(bundle, id) && !facts.externals.has(id)) facts.externals.set(id, importer);
            };
            for (const output of Object.values(bundle)) {
                if (output.type !== "chunk") continue;
                facts.modules.push(...output.moduleIds);
                for (const module of output.moduleIds) {
                    const info = this.getModuleInfo(module);
                    for (const id of [...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? [])]) record(id, module);
                }
                // 打包器自己的运行时辅助代码（例如服务端产物里的 `node:module`）没有模块信息。
                for (const id of output.imports) record(id, null);
            }
        },
    };
}

/**
 * 浏览器产物的登记外壳：CommonJS 模块体包进工厂函数，脚本执行时交给宿主；外壳经 banner 与 footer 加上，source map 由
 * 打包器一并换算。
 * - `"use strict"` 写在工厂函数体开头：作者写的是 ES 模块，本来就是严格模式，服务端产物（ESM）也是；包成脚本里的普通函数
 *   后不写就成了非严格，同一份源码两端语义不同。
 * - 脚本地址在脚本执行时记下：`document.currentScript` 只在脚本同步执行期间有值，工厂是之后每次激活才调用的。
 *   `import.meta.url` 在构建时换成它（见 `buildEntry` 的 `define`）。外层的块让这个变量不落到全局。
 */
const SCRIPT_URL = "__nbookScriptUrl";
const REGISTER_BANNER = `{const ${SCRIPT_URL} = document.currentScript.src; globalThis[${JSON.stringify(NEUROBOOK_PROFILE.registryGlobal)}].register(${SCRIPT_URL}, function (module, exports, require) {"use strict";`;
const REGISTER_FOOTER = "});}";

/** 入口的外壳模块：从定义模块里取出这个入口，只导出它的 `activate`。 */
function shellSource(plugin: string, located: LocatedEntry): string {
    const match = `(item) => item.id === ${JSON.stringify(located.entry.id)} && item.location === ${JSON.stringify(located.location)}`;
    return [
        `import * as source from ${JSON.stringify(located.module)};`,
        `const definition = Object.values(source).find((value) => value !== null && typeof value === "object" && value.id === ${JSON.stringify(plugin)} && Array.isArray(value.entries) && value.entries.some(${match}));`,
        `const entry = definition.entries.find(${match});`,
        // 只提供组件、没有初始化逻辑的浏览器入口可以不写 activate（plugin-api.md 的“输入与前置条件”）。
        `export const activate = entry.activate ?? (() => ({}));`,
        "",
    ].join("\n");
}

/**
 * source map 里的源文件路径：相对作者目录，不带构建机的目录结构（产物会发布出去）。作者目录之外的依赖（工作区提升到上层的
 * `node_modules`、软链）取 `node_modules/` 之后的部分；构建时生成的外壳取它在临时目录里的名字。
 */
function sourcePath(file: string, root: string, workDir: string): string {
    const path = within(file, workDir) ? join("nbook-plugin-build", relative(workDir, file))
        : within(file, root) ? relative(root, file)
        : file.includes(`${sep}node_modules${sep}`) ? file.slice(file.lastIndexOf(`${sep}node_modules${sep}`) + 1)
        : join("external", basename(file));
    return path.split(sep).join("/");
}

async function buildEntry(input: {
    readonly root: string;
    readonly plugin: string;
    readonly located: LocatedEntry;
    readonly alias: ReadonlyArray<BuildAlias>;
    readonly workDir: string;
}): Promise<{readonly directory: string; readonly facts: BundleFacts}> {
    const {located} = input;
    const shell = join(input.workDir, `${located.entry.id}.shell.ts`);
    await writeFile(shell, shellSource(input.plugin, located));
    const directory = join(input.workDir, located.entry.id);
    const facts: BundleFacts = {modules: [], externals: new Map()};
    const external = (id: string): boolean => !VUE_REEXPORTED.test(id) && (ALWAYS_EXTERNAL.some((pattern) => pattern.test(id)) || isNodeBuiltin(id));
    const browser = located.location === "browser";
    try {
        await vite({
            configFile: false,
            root: input.root,
            logLevel: "warn",
            plugins: [vueRuntimePlugin(), vuePlugin(), factsPlugin(facts)],
            resolve: {alias: [...input.alias]},
            define: browser ? {"process.env.NODE_ENV": JSON.stringify("production"), "import.meta.url": SCRIPT_URL} : {},
            build: {
                outDir: directory,
                emptyOutDir: true,
                // 浏览器每次装载都下载、解析整份产物；服务端产物从磁盘读，不压缩以便读栈。
                minify: browser,
                sourcemap: true,
                ssr: browser ? false : shell,
                target: browser ? "es2022" : "node22",
                lib: browser ? {entry: shell, formats: ["cjs"], fileName: () => `${located.entry.id}.js`, cssFileName: located.entry.id} : undefined,
                rolldownOptions: {
                    external,
                    output: {
                        codeSplitting: false,
                        sourcemapPathTransform: (source, sourcemapPath) => sourcePath(resolve(dirname(sourcemapPath), source), input.root, input.workDir),
                        ...(browser
                            // CommonJS 产物里外部模块的动态导入默认留成 `import("vue")`：经典脚本里没有 import map，裸说明符解析失败。
                            // 改成 `require`，与静态导入一样从宿主模块表取。
                            ? {banner: REGISTER_BANNER, footer: REGISTER_FOOTER, dynamicImportInCjs: false}
                            : {entryFileNames: `${located.entry.id}.js`, format: "es" as const}),
                    },
                },
            },
            ssr: browser ? undefined : {noExternal: true, target: "node"},
        });
    } catch (error) {
        throw bundlerError(error, input.root, located) ?? error;
    }
    return {directory, facts};
}

/**
 * 打包器报告的错误（Rolldown 的错误带 `errors` 数组，每项有错误码、消息与位置）换成 `PluginBuildError`：路径是入口 id，
 * 消息去掉终端颜色码。浏览器入口的“不支持的特性”另说明原因：登记工厂是同步执行的 CommonJS 函数，顶层 await 这类只有 ES
 * 模块才有的写法用不了，作者从没选过输出格式，原样的“cjs 不支持”看不懂。不是这种形状的错误原样抛出。
 */
function bundlerError(error: unknown, root: string, located: LocatedEntry): PluginBuildError | null {
    const errors = typeof error === "object" && error !== null ? (error as {readonly errors?: unknown}).errors : undefined;
    if (!Array.isArray(errors) || errors.length === 0) return null;
    const problems = errors.map((item: {readonly code?: unknown; readonly message?: unknown; readonly id?: unknown; readonly loc?: {readonly line?: unknown; readonly column?: unknown}}): ManifestProblem => {
        const where = typeof item.id === "string" && isAbsolute(item.id) ? `${relative(root, item.id)}${typeof item.loc?.line === "number" ? `:${String(item.loc.line)}:${String(item.loc.column)}` : ""}：` : "";
        const hint = located.location === "browser" && item.code === "UNSUPPORTED_FEATURE" ? "（浏览器入口打成同步执行的登记工厂，不支持顶层 await 这类只有 ES 模块才有的写法：把它挪进 activate）" : "";
        return {path: `entries.${located.entry.id}`, message: `${where}${stripVTControlCharacters(String(item.message ?? item.code)).split("\n")[0]!.trim()}${hint}`};
    });
    return new PluginBuildError("打包失败", problems, {cause: error});
}

/**
 * 纯度检查：打进了不许打进的包，或外部引用不在本位置的宿主模块表里。“未共享”写上引入它的模块：常常是间接依赖引进来的，
 * 作者要知道换哪个库。
 */
function purityProblems(input: {
    readonly location: BuiltLocation;
    readonly entry: string;
    readonly facts: BundleFacts;
    readonly forbidden: ReadonlyArray<{readonly name: string; readonly directory: string}>;
    readonly root: string;
    readonly workDir: string;
}): ManifestProblem[] {
    const {location, entry, facts, forbidden} = input;
    const problems: ManifestProblem[] = [];
    const allowed: ReadonlyArray<string> = location === "browser" ? BROWSER_SHARED_MODULES : SERVER_SHARED_MODULES;
    for (const [specifier, importer] of facts.externals) {
        if (allowed.includes(specifier) || (location !== "browser" && isNodeBuiltin(specifier))) continue;
        const from = importer === null || !isAbsolute(importer) ? "" : `（由 ${sourcePath(importer.split("?")[0]!, input.root, input.workDir)} 引入）`;
        // nb-ui 不发布，作者项目里本来装不到它；仓库里照着内置插件的写法直接导入时提示改法。
        const hint = /^@notnotype\/nb-ui($|\/)/u.test(specifier) ? "；nb-ui 的组件从 @notnotype/nb-plugin-sdk/components 导入" : "";
        problems.push({path: `entries.${entry}`, message: `引用了宿主没有共享的模块 ${specifier}${from}：该入口未共享（共享的是 ${allowed.join("、")}）${hint}`});
    }
    const bundled = new Map<string, string>();
    for (const module of facts.modules) {
        // `\0` 开头的是打包器的虚拟模块（运行时辅助代码），不是磁盘上的文件。
        const file = module.split("?")[0]!;
        if (!isAbsolute(file)) continue;
        const hit = forbidden.find((item) => within(file, item.directory));
        if (hit !== undefined && !bundled.has(hit.name)) bundled.set(hit.name, file);
    }
    for (const [name, file] of bundled) problems.push({path: `entries.${entry}`, message: `打进了 ${name} 的实现（${file}）：它由宿主提供，插件要从包名导入、不能自带一份`});
    return problems;
}

/**
 * 插件用到的 Lucide 图标类；宿主的公共遮罩规则匹配 `i-lucide-` 前缀，这里只补每个图标的 `--svg`。`texts` 是清单的 JSON
 * 文本（声明里的图标在入口激活前就要显示，而声明不一定写在入口导入的模块里）与各入口模块图里的源码（含打进来的依赖）。
 * 别的图标集（`i-<集>-<名字>`）没有规则，只给警告。拼接出来的类名静态找不到，作者文档里写明。
 */
async function iconRules(texts: Iterable<string>, root: string): Promise<{readonly css: string; readonly warnings: string[]}> {
    const names = new Set<string>();
    const others = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(/\bi-([a-z0-9]+)-([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu)) {
            if (match[1] === "lucide") names.add(match[2]!);
            else others.add(match[0]);
        }
    }
    const warnings = [...others].sort().map((name) => `图标类 ${name} 不是 Lucide 图标：插件只能用 Lucide 图标，它不会显示`);
    if (names.size === 0) return {css: "", warnings};
    const lucide = JSON.parse(await readFile(iconSetFile(root), "utf8")) as Parameters<typeof getIconData>[0];
    const rules: string[] = [];
    for (const name of [...names].sort()) {
        const data = getIconData(lucide, name);
        if (data === null) {
            warnings.push(`源码里的图标类 i-lucide-${name} 在 Lucide 里不存在，不会显示`);
            continue;
        }
        const built = iconToSVG(data, {height: "1em"});
        rules.push(`.i-lucide-${name} { --svg: ${svgToURL(iconToHTML(built.body, built.attributes))}; }`);
    }
    return {css: rules.join("\n"), warnings};
}

/** Lucide 图标数据：先找作者项目的，没有就用构建预设自己依赖的那份。 */
function iconSetFile(root: string): string {
    const id = "@iconify-json/lucide/icons.json";
    try {
        return createRequire(join(root, "package.json")).resolve(id);
    } catch {
        return createRequire(import.meta.url).resolve(id);
    }
}

export async function buildPlugin(options: BuildPluginOptions): Promise<BuildPluginResult> {
    const root = resolve(options.root);
    const outDir = resolve(options.outDir);
    const alias = options.alias ?? [];
    if (existsSync(outDir) && (await readdir(outDir)).length > 0) throw new PluginBuildError("输出目录不是空的", [{path: "", message: outDir}]);
    const author = await readAuthor(root);
    const id = `${author.publisher}.${author.name}`;

    // 1. 读声明：执行描述与入口定义模块，不调用 activate。
    const definitionFiles = (author.nbook?.definitions ?? DEFAULT_DEFINITIONS.filter((file) => existsSync(join(root, file)))).map((file) => join(root, file));
    const [descriptorModule, ...definitionModules] = await loadModules(root, alias, [join(root, "plugin.ts"), ...definitionFiles]);
    const descriptor = descriptorModule!.descriptor as PluginDescriptor | undefined;
    if (descriptor === undefined) throw new PluginBuildError("plugin.ts 没有导出 descriptor", [{path: "plugin.ts", message: "要导出插件描述 descriptor"}]);
    if (descriptor.id !== id || descriptor.version !== author.version) {
        throw new PluginBuildError("插件描述与 package.json 不一致", [{path: "plugin.ts", message: `描述是 ${descriptor.id}@${descriptor.version}，package.json 是 ${id}@${author.version}`}]);
    }
    const definitions: PluginDefinition[] = [];
    const located: LocatedEntry[] = [];
    const problems: ManifestProblem[] = [];
    for (const [index, file] of definitionFiles.entries()) {
        for (const value of Object.values(definitionModules[index]!)) {
            if (!isPluginDefinition(value)) continue;
            if (value.id !== id) {
                problems.push({path: relative(root, file), message: `导出的插件定义的 id 是 ${value.id}，插件是 ${id}`});
                continue;
            }
            definitions.push(value);
            for (const entry of value.entries) {
                if (!(BUILT_LOCATIONS as ReadonlyArray<string>).includes(entry.location)) {
                    problems.push({path: `entries.${entry.id}`, message: `构建预设只构建 ${BUILT_LOCATIONS.join("、")} 位置的入口：${entry.location}`});
                    continue;
                }
                located.push({entry, location: entry.location as BuiltLocation, module: file});
            }
        }
    }
    if (problems.length > 0) throw new PluginBuildError("入口定义不合格", problems);

    const source: ManifestSource = {
        descriptor: {...descriptor, version: options.version ?? descriptor.version},
        definitions,
        engine: author.engines?.[manifestFormat.platform.engine] ?? `^${PRODUCT_VERSION}`,
        ...(author.pluginVersions === undefined ? {} : {pluginVersions: author.pluginVersions}),
        ...(author.description === undefined ? {} : {description: author.description}),
        ...(author.license === undefined ? {} : {license: author.license}),
        mainOf: (entry: PluginEntryDefinition) => `${entry.id}.js`,
    };
    // 清单表达不了的定义（入口 id 重复、schema 进不了 JSON……）在构建前就报出：下面要按入口 id 写文件，入口 id 的规则由
    // 清单校验保证。
    const early = manifestFormat.build(source);
    if (early.status === "invalid") throw new PluginBuildError("代码定义写不成清单", early.problems);

    // 2. 逐入口构建（Rolldown 的多入口构建不能同时关掉代码分割）。
    const forbidden: Array<{readonly name: string; readonly directory: string}> = [];
    for (const name of HOST_PACKAGES) {
        const directory = await packageRoot(root, name);
        if (directory !== null) forbidden.push({name, directory});
    }
    for (const directory of options.forbiddenDirectories ?? []) forbidden.push({name: "应用源码（SDK 的别名指向这里）", directory: await realpath(directory)});
    // 中间产物放在输出目录里的隐藏目录：最后按文件 rename 到输出目录，同一个目录之下必然在同一个文件系统上。系统临时目录
    // 常在另一个文件系统（tmpfs），输出目录的父目录可能不可写或在挂载点之外，两处都会让 rename 失败。构建被中断时残留也只在
    // 输出目录里，下次构建前要先清空它（输出目录必须为空）。
    await mkdir(outDir, {recursive: true});
    const workDir = await mkdtemp(join(outDir, ".nbook-plugin-build-"));
    const files: string[] = [];
    const styles: string[] = [];
    const sources = new Set<string>();
    try {
        const built: Array<{readonly located: LocatedEntry; readonly directory: string}> = [];
        for (const item of located) {
            const {directory, facts} = await buildEntry({root, plugin: id, located: item, alias, workDir});
            problems.push(...purityProblems({location: item.location, entry: item.entry.id, facts, forbidden, root, workDir}));
            for (const module of facts.modules) {
                const file = module.split("?")[0]!;
                if (isAbsolute(file) && existsSync(file)) sources.add(file);
            }
            built.push({located: item, directory});
        }
        if (problems.length > 0) throw new PluginBuildError("产物不纯", problems);

        // 3. 样式与图标。
        for (const {located: item, directory} of built) {
            const css = join(directory, `${item.entry.id}.css`);
            if (existsSync(css)) styles.push(await readFile(css, "utf8"));
        }
        // 最终清单只比 early 多一个 style 字段，图标从 early 里找。
        const texts = [JSON.stringify(early.json)];
        for (const file of sources) texts.push(await readFile(file, "utf8"));
        const icons = await iconRules(texts, root);
        const merged = [...new Set(styles.map((text) => text.trim()).filter((text) => text !== ""))];
        const style = merged.length === 0 && icons.css === "" ? null : `@layer components {\n${[...merged, icons.css].filter((text) => text !== "").join("\n")}\n}\n`;

        // 4. 清单与输出。
        const final = manifestFormat.build({...source, ...(style === null ? {} : {style: "style.css"})});
        if (final.status === "invalid") throw new PluginBuildError("代码定义写不成清单", final.problems);
        const manifest = final.json;

        await mkdir(outDir, {recursive: true});
        for (const {located: item, directory} of built) {
            for (const name of [`${item.entry.id}.js`, `${item.entry.id}.js.map`]) {
                if (!existsSync(join(directory, name))) continue;
                await rename(join(directory, name), join(outDir, name));
                files.push(name);
            }
        }
        if (style !== null) {
            await writeFile(join(outDir, "style.css"), style);
            files.push("style.css");
        }
        await writeFile(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 4)}\n`);
        files.push("package.json");
        return {manifest, files: files.sort(), warnings: icons.warnings};
    } finally {
        await rm(workDir, {recursive: true, force: true});
    }
}

/**
 * 开发版本（作者工具的 `--dev`）：作者的版本加上构建元数据 `+dev.<UTC 时间到秒>.<毫秒>`。用构建元数据而不是预发布段：
 * `0.1.0-dev.…` 比 `0.1.0` 旧，插件页会当成降级，依赖它的插件写的 `^0.1.0` 也不接受预发布版本；构建元数据不改变 semver 的
 * 优先级，`compareVersions` 再按它排出先后，所以每次构建都比上一次新，安装按升级处理。时间与毫秒分成两段数字：连在一起的
 * 17 位超过安全整数，比较不出先后。
 */
export function devVersion(version: string, now: Date): string {
    const [seconds, millis] = now.toISOString().replace(/Z$/u, "").split(".") as [string, string];
    const stamp = `dev.${seconds.replace(/\D/gu, "")}.${String(Number(millis))}`;
    return version.includes("+") ? `${version}.${stamp}` : `${version}+${stamp}`;
}

/**
 * 输出目录里是不是这个插件上次的产物（可以清空重建）：清单的 publisher、name 与作者的相同，并且有 `entries`（构建预设总会写，
 * 作者的 `package.json` 不写）；或者只有中断的构建留下的中间目录。
 */
export async function isPreviousBuild(root: string, outDir: string): Promise<boolean> {
    const names = await readdir(outDir);
    if (names.every((item) => item.startsWith(".nbook-plugin-build-"))) return true;
    const manifest = join(outDir, "package.json");
    if (!existsSync(manifest)) return false;
    const [author, previous] = await Promise.all([readJsonObject(join(root, "package.json")), readJsonObject(manifest)]);
    return previous.publisher === author.publisher && previous.name === author.name && typeof previous.entries === "object" && previous.entries !== null;
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
    try {
        const value: unknown = JSON.parse(await readFile(file, "utf8"));
        return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    } catch (error) {
        throw new PluginBuildError("读不了 package.json", [{path: "", message: `${file}：${error instanceof Error ? error.message : String(error)}`}], {cause: error});
    }
}

if (import.meta.main) {
    const [root, outDir] = process.argv.slice(2);
    if (root === undefined || outDir === undefined) {
        console.error("用法：bun scripts/plugin-sdk/build-plugin.ts <插件目录> <输出目录>");
        process.exit(2);
    }
    try {
        const result = await buildPlugin({root, outDir});
        for (const warning of result.warnings) console.warn(warning);
        console.log(`插件已构建：${resolve(outDir)}（${result.files.join("、")}）`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
