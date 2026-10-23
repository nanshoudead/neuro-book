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
 * - `package.json`：作者的字段加上由代码定义生成的清单（内核的 `manifestOf`），生成后用 `readPluginManifest` 再校验一遍；
 * - 每个入口一个文件 `<入口 id>.js`（带 source map），只导出 `activate`，声明以清单为准。服务端与项目入口是 ESM；浏览器
 *   入口包成登记工厂，脚本执行时调用宿主的 `register`，每次激活宿主调用一次工厂。动态导入都内联进这个文件；
 * - `style.css`：各入口的样式合并后包进 `@layer components`，加上插件用到的 Lucide 图标的规则（宿主只为自己源码里出现过的
 *   图标类生成规则）。
 *
 * 共享模块（`nbook/shared/plugin-modules`）留作外部引用；纯度检查按打包器的模块图核对：打进了 Vue、`@vue/*`、nb-ui 或 SDK
 * 的实现就失败，外部引用不在宿主模块表里也失败（“未共享”），两件事都在构建时报出。
 */

import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile} from "node:fs/promises";
import {builtinModules, createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";

import {manifestOf, readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {ManifestProblem} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {getIconData, iconToHTML, iconToSVG, svgToURL} from "@iconify/utils";
import vue from "@vitejs/plugin-vue";
import * as compiler from "vue/compiler-sfc";
import {build as vite, createServer} from "vite";
import type {Alias, Plugin} from "vite";

import {BROWSER_SHARED_MODULES, PLUGIN_REGISTRY_GLOBAL, SERVER_SHARED_MODULES} from "../../src/shared/plugin-modules";
import {PRODUCT_VERSION} from "../../src/shared/product";
import {npmVersions} from "../../src/shared/versions";

const DEFAULT_DEFINITIONS = ["backend/plugin.ts", "web/plugin.ts"];
const BUILT_LOCATIONS = ["server", "project", "browser"] as const;
type BuiltLocation = (typeof BUILT_LOCATIONS)[number];

/** 这些包的引用一律留作外部，再按模块表判断能不能用：打进产物会出现第二份（第二份 Vue、第二份内核）。 */
const ALWAYS_EXTERNAL = [/^vue($|\/)/u, /^@vue\//u, /^@notnotype\/nb-ui($|\/)/u, /^@notnotype\/nb-plugin-sdk($|\/)/u, /^@notnotype\/nb-runtime($|\/)/u];
/** 从 `vue` 再导出的包：引用改写成外部的 `vue`，与宿主是同一份（依赖里的库常直接引用它们）。 */
const VUE_REEXPORTED = /^@vue\/runtime-(?:core|dom)$/u;
/** 不许打进产物的包（解析到它们的目录就是打进了第二份）。 */
const FORBIDDEN_PACKAGES = ["vue", "@vue/reactivity", "@vue/runtime-core", "@vue/runtime-dom", "@vue/shared", "@notnotype/nb-ui", "@notnotype/nb-plugin-sdk", "@notnotype/nb-runtime"];

export interface BuildPluginOptions {
    /** 作者目录：含 `package.json` 与 `plugin.ts`。 */
    readonly root: string;
    /** 输出目录：不存在或为空。 */
    readonly outDir: string;
    /** 额外的解析别名。仓库里的示例把 SDK 指到应用源码；仓库外的作者不用。 */
    readonly alias?: ReadonlyArray<Alias>;
    /** 另外不许打进产物的目录。仓库里是应用源码：SDK 的别名指到那里，打进去就是第二份 SDK。 */
    readonly forbiddenDirectories?: ReadonlyArray<string>;
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
    readonly problems: ReadonlyArray<ManifestProblem>;

    constructor(summary: string, problems: ReadonlyArray<ManifestProblem>) {
        super(`${summary}：${problems.map((problem) => (problem.path === "" ? problem.message : `${problem.path}：${problem.message}`)).join("；")}`);
        this.name = "PluginBuildError";
        this.problems = problems;
    }
}

interface AuthorPackage {
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly license?: string;
    readonly engines?: {readonly neurobook?: string};
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
    readonly externals: string[];
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
    return typeof value === "object" && value !== null && typeof (value as {id?: unknown}).id === "string" && Array.isArray((value as {entries?: unknown}).entries);
}

async function readAuthor(root: string): Promise<AuthorPackage> {
    const raw: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
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
 * 插件与别名，能加载 `.vue` 与 TypeScript。关掉依赖发现：发现进行中时 `close()` 不结算。
 */
async function loadModules(root: string, alias: ReadonlyArray<Alias>, files: ReadonlyArray<string>): Promise<Array<Record<string, unknown>>> {
    const server = await createServer({
        configFile: false,
        root,
        logLevel: "error",
        appType: "custom",
        plugins: [vuePlugin()],
        resolve: {alias: [...alias]},
        server: {middlewareMode: true, hmr: false, watch: null},
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

/** 记下打包器的模块图：打进了哪些模块、留下了哪些外部引用。 */
function factsPlugin(facts: BundleFacts): Plugin {
    return {
        name: "nbook-plugin-facts",
        generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
                if (output.type !== "chunk") continue;
                facts.modules.push(...output.moduleIds);
                facts.externals.push(...output.imports.filter((id) => !Object.hasOwn(bundle, id)));
            }
        },
    };
}

/**
 * 浏览器产物的登记外壳：CommonJS 模块体包进工厂函数，脚本执行时交给宿主。`"use strict"` 落在函数体开头，仍是指令；
 * 外壳经 banner 与 footer 加上，source map 由打包器一并换算。
 */
const REGISTER_BANNER = `globalThis[${JSON.stringify(PLUGIN_REGISTRY_GLOBAL)}].register(document.currentScript.src, function (module, exports, require) {`;
const REGISTER_FOOTER = "});";

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

async function buildEntry(input: {
    readonly root: string;
    readonly plugin: string;
    readonly located: LocatedEntry;
    readonly alias: ReadonlyArray<Alias>;
    readonly workDir: string;
}): Promise<{readonly directory: string; readonly facts: BundleFacts}> {
    const {located} = input;
    const shell = join(input.workDir, `${located.entry.id}.shell.ts`);
    await writeFile(shell, shellSource(input.plugin, located));
    const directory = join(input.workDir, located.entry.id);
    const facts: BundleFacts = {modules: [], externals: []};
    const external = (id: string): boolean => !VUE_REEXPORTED.test(id) && (ALWAYS_EXTERNAL.some((pattern) => pattern.test(id)) || isNodeBuiltin(id));
    const browser = located.location === "browser";
    await vite({
        configFile: false,
        root: input.root,
        logLevel: "warn",
        plugins: [vueRuntimePlugin(), vuePlugin(), factsPlugin(facts)],
        resolve: {alias: [...input.alias]},
        define: browser ? {"process.env.NODE_ENV": JSON.stringify("production")} : {},
        build: {
            outDir: directory,
            emptyOutDir: true,
            minify: false,
            sourcemap: true,
            ssr: browser ? false : shell,
            target: browser ? "es2022" : "node22",
            lib: browser ? {entry: shell, formats: ["cjs"], fileName: () => `${located.entry.id}.js`, cssFileName: located.entry.id} : undefined,
            rolldownOptions: {
                external,
                output: {
                    codeSplitting: false,
                    ...(browser ? {banner: REGISTER_BANNER, footer: REGISTER_FOOTER} : {entryFileNames: `${located.entry.id}.js`, format: "es" as const}),
                },
            },
        },
        ssr: browser ? undefined : {noExternal: true, target: "node"},
    });
    return {directory, facts};
}

/** 纯度检查：打进了不许打进的包，或外部引用不在本位置的宿主模块表里。 */
function purityProblems(location: BuiltLocation, entry: string, facts: BundleFacts, forbidden: ReadonlyArray<{readonly name: string; readonly directory: string}>): ManifestProblem[] {
    const problems: ManifestProblem[] = [];
    const allowed: ReadonlyArray<string> = location === "browser" ? BROWSER_SHARED_MODULES : SERVER_SHARED_MODULES;
    for (const specifier of new Set(facts.externals)) {
        if (allowed.includes(specifier) || (location !== "browser" && isNodeBuiltin(specifier))) continue;
        problems.push({path: `entries.${entry}`, message: `引用了宿主没有共享的模块 ${specifier}：该入口未共享（共享的是 ${allowed.join("、")}）`});
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

/** 源码里出现的 Lucide 图标类；宿主的公共遮罩规则匹配 `i-lucide-` 前缀，这里只补每个图标的 `--svg`。 */
async function iconRules(sources: ReadonlyArray<string>, root: string): Promise<{readonly css: string; readonly warnings: string[]}> {
    const names = new Set<string>();
    for (const file of sources) {
        const text = await readFile(file, "utf8");
        for (const match of text.matchAll(/\bi-lucide-([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu)) names.add(match[1]!);
    }
    if (names.size === 0) return {css: "", warnings: []};
    const lucide = JSON.parse(await readFile(iconSetFile(root), "utf8")) as Parameters<typeof getIconData>[0];
    const rules: string[] = [];
    const warnings: string[] = [];
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

    const engines = {neurobook: author.engines?.neurobook ?? `^${PRODUCT_VERSION}`};
    const source = {descriptor, definitions, engines, pluginVersions: author.pluginVersions, mainOf: (entry: PluginEntryDefinition) => `${entry.id}.js`};
    // 清单表达不了的定义（入口 id 重复、schema 进不了 JSON……）在构建前就报出。
    const early = manifestOf(source);
    if (early.status === "invalid") throw new PluginBuildError("代码定义写不成清单", early.problems);

    // 2. 逐入口构建（Rolldown 的多入口构建不能同时关掉代码分割）。
    const forbidden: Array<{readonly name: string; readonly directory: string}> = [];
    for (const name of FORBIDDEN_PACKAGES) {
        const directory = await packageRoot(root, name);
        if (directory !== null) forbidden.push({name, directory});
    }
    for (const directory of options.forbiddenDirectories ?? []) forbidden.push({name: "应用源码（SDK 的别名指向这里）", directory: await realpath(directory)});
    const workDir = await mkdtemp(join(tmpdir(), "nbook-plugin-build-"));
    const files: string[] = [];
    const styles: string[] = [];
    const browserSources = new Set<string>();
    try {
        const built: Array<{readonly located: LocatedEntry; readonly directory: string}> = [];
        for (const item of located) {
            const {directory, facts} = await buildEntry({root, plugin: id, located: item, alias, workDir});
            problems.push(...purityProblems(item.location, item.entry.id, facts, forbidden));
            if (item.location === "browser") {
                for (const module of facts.modules) {
                    const file = module.split("?")[0]!;
                    if (isAbsolute(file) && !file.includes(`${sep}node_modules${sep}`) && existsSync(file)) browserSources.add(file);
                }
            }
            built.push({located: item, directory});
        }
        if (problems.length > 0) throw new PluginBuildError("产物不纯", problems);

        // 3. 样式与图标。
        for (const {located: item, directory} of built) {
            const css = join(directory, `${item.entry.id}.css`);
            if (existsSync(css)) styles.push(await readFile(css, "utf8"));
        }
        const icons = await iconRules([...browserSources], root);
        const merged = [...new Set(styles.map((text) => text.trim()).filter((text) => text !== ""))];
        const style = merged.length === 0 && icons.css === "" ? null : `@layer components {\n${[...merged, icons.css].filter((text) => text !== "").join("\n")}\n}\n`;

        // 4. 清单与输出。
        const final = manifestOf({...source, ...(style === null ? {} : {style: "style.css"})});
        if (final.status === "invalid") throw new PluginBuildError("代码定义写不成清单", final.problems);
        const manifest: Record<string, unknown> = {
            ...final.json,
            ...(author.description === undefined ? {} : {description: author.description}),
            ...(author.license === undefined ? {} : {license: author.license}),
        };
        const checked = readPluginManifest(manifest, {versions: npmVersions});
        if (checked.status === "invalid") throw new PluginBuildError("生成的清单不合格", checked.problems);

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
