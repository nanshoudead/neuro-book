/**
 * 生成可以安装的插件 SDK 包 `@notnotype/nb-plugin-sdk`（docs/specs/runtime/plugin-api.md 的“SDK”）：
 *
 * - `index.js`、`browser.js`、`components.js`：`src/sdk/` 打包后的实现（`components` 是 nb-ui 的组件）。插件运行时用的是宿主模块表里的那一份，这两份只在作者构建插件时
 *   执行入口定义（生成清单）、以及在仓库外写测试时用；`vue`、`@vue/*`、`typebox` 不打进去，由作者的项目提供同一份。
 * - `index.d.ts`、`browser.d.ts`、`components.d.ts`：打平的类型，不含应用内部的 `nbook/*` 别名，只引用 `vue`、
 *   `@vue/reactivity` 与 `typebox`。内核、nb-form 与 nb-ui 的子路径映射到源码，类型才会被打进来：经 `node_modules` 解析到的工作区包被 TypeScript
 *   当作外部库，不生成声明。
 * - `build.js`、`build.d.ts`：构建预设（`build-plugin.ts`），在 Node 或 Bun 里运行；Vite、单文件组件编译与图标数据是它的
 *   依赖。
 * - `package.json`：版本取产品版本；`vue`、`@vue/reactivity`、`typebox` 是 peer 依赖，构建预设的工具是普通依赖。
 *
 * 用法：`bun run build:sdk [输出目录]`，缺省输出到 `dist/plugin-sdk/`。输出目录只在不存在、为空或者是上次生成的 SDK 包时
 * 清空重建，否则拒绝。
 */

import {existsSync} from "node:fs";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import vue from "@vitejs/plugin-vue";
import {build as rolldown} from "rolldown";
import {dts} from "rolldown-plugin-dts";
import {build as vite} from "vite";

import {PRODUCT_VERSION} from "../../src/shared/product";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const SDK_NAME = "@notnotype/nb-plugin-sdk";
const ENTRIES = {index: join(packageRoot, "src/sdk/index.ts"), browser: join(packageRoot, "src/sdk/browser.ts"), components: join(packageRoot, "src/sdk/components.ts")};
/** 由作者的项目提供、不打进 SDK 的包：插件运行时宿主给的是同一份。 */
const PEERS = [/^vue($|\/)/u, /^@vue\//u, /^typebox($|\/)/u];
const RUNTIME_SUBPATHS = ["lifecycle", "services", "plugins", "plugin-manifest", "application", "diagnostics", "remote"];

/** 类型打包要的路径映射：应用别名，加上内核与 nb-form 的子路径直接指到源码。 */
function typePaths(): Record<string, string[]> {
    const paths: Record<string, string[]> = {"nbook/*": ["./src/*"]};
    for (const name of RUNTIME_SUBPATHS) paths[`@notnotype/nb-runtime/${name}`] = [`../nb-runtime/src/${name}/${name}.ts`];
    paths["@notnotype/nb-form"] = ["../nb-form/src/index.ts"];
    paths["@notnotype/nb-form/vue"] = ["../nb-form/src/vue/index.ts"];
    paths["@notnotype/nb-ui/components"] = ["../nb-ui/src/components/index.ts"];
    return paths;
}

/** 构建预设在作者机器上运行时要的包；版本跟应用自己用的一致。 */
const BUILD_DEPENDENCIES = ["vite", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide", "semver"];

async function dependencyRanges(names: ReadonlyArray<string>): Promise<Record<string, string>> {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    return Object.fromEntries(names.map((name) => {
        const value = manifest.dependencies[name] ?? manifest.devDependencies[name];
        if (value === undefined) throw new Error(`应用的 package.json 里没有 ${name}`);
        return [name, value];
    }));
}

/**
 * 清空上次生成的 SDK 包。输出目录来自命令行，传错了（`.`、项目目录）不能被递归删除：只认不存在、为空，或者 `package.json`
 * 的 `name` 是 SDK 包名的目录。
 */
async function clearPreviousSdk(outDir: string): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    const manifest = join(outDir, "package.json");
    let name: unknown = null;
    if (existsSync(manifest)) {
        try {
            name = (JSON.parse(await readFile(manifest, "utf8")) as {name?: unknown} | null)?.name;
        } catch (error) {
            throw new Error(`输出目录 ${outDir} 的 package.json 读不了，不清理`, {cause: error});
        }
    }
    if (name !== SDK_NAME) throw new Error(`输出目录 ${outDir} 不是空的，也不是上次生成的 ${SDK_NAME}，不清理`);
    await rm(outDir, {recursive: true});
}

export async function buildSdk(outDir: string): Promise<void> {
    await clearPreviousSdk(outDir);
    await vite({
        configFile: false,
        logLevel: "warn",
        plugins: [vue()],
        resolve: {alias: [{find: /^nbook\//u, replacement: join(packageRoot, "src/")}]},
        build: {
            outDir,
            emptyOutDir: false,
            minify: false,
            // 组件的样式由宿主的页面提供，SDK 的构建期实现用不到。
            cssCodeSplit: false,
            lib: {entry: ENTRIES, formats: ["es"], fileName: (_format, name) => `${name}.js`, cssFileName: "unused"},
            rolldownOptions: {external: PEERS},
        },
    });
    await rm(join(outDir, "unused.css"), {force: true});
    await rolldown({
        cwd: packageRoot,
        input: ENTRIES,
        external: PEERS,
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.web.json", compilerOptions: {paths: typePaths()}, vue: true, emitDtsOnly: true})],
        output: {dir: outDir},
        // 生成声明本来就慢（vue-tsc），不报插件耗时。
        checks: {pluginTimings: false},
    });
    // 构建预设：Node 工具，打进内核的清单与应用的版本工具；Vite 与编译器、图标数据留作依赖。声明文件一并生成，作者的
    // 构建脚本用得上 `BuildPluginOptions`、`PluginBuildError` 这些类型。
    await rolldown({
        cwd: packageRoot,
        input: {build: join(packageRoot, "scripts/plugin-sdk/build-plugin.ts")},
        platform: "node",
        external: [...PEERS, ...BUILD_DEPENDENCIES.map((name) => new RegExp(`^${name.replace("/", "\\/")}($|/)`, "u"))],
        resolve: {alias: {nbook: join(packageRoot, "src")}},
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.json", compilerOptions: {paths: typePaths()}})],
        output: {dir: outDir, format: "es", entryFileNames: "[name].js"},
        checks: {pluginTimings: false},
    });
    const peers = await dependencyRanges(["vue", "typebox"]);
    // vue 的每个版本都把 @vue/reactivity 钉在同一个版本上：用与 vue 相同的范围，作者项目里两者才配成一对。
    peers["@vue/reactivity"] = peers.vue!;
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: SDK_NAME,
        version: PRODUCT_VERSION,
        description: "NeuroBook 插件 SDK：类型与构建期实现；插件运行时由宿主提供同一份",
        type: "module",
        exports: {
            ".": {types: "./index.d.ts", import: "./index.js"},
            "./browser": {types: "./browser.d.ts", import: "./browser.js"},
            "./components": {types: "./components.d.ts", import: "./components.js"},
            "./build": {types: "./build.d.ts", import: "./build.js"},
        },
        peerDependencies: peers,
        dependencies: await dependencyRanges(BUILD_DEPENDENCIES),
    }, null, 4)}\n`);
}

if (import.meta.main) {
    const target = resolve(process.argv[2] ?? join(packageRoot, "dist/plugin-sdk"));
    await buildSdk(target);
    console.log(`插件 SDK 已生成：${target}`);
}
