/**
 * 生成可以安装的插件 SDK 包 `@notnotype/nb-plugin-sdk`（docs/specs/runtime/plugin-api.md 的“SDK”）：
 *
 * - `index.js`、`browser.js`：`src/sdk/` 打包后的实现。插件运行时用的是宿主模块表里的那一份，这两份只在作者构建插件时
 *   执行入口定义（生成清单）、以及在仓库外写测试时用；`vue`、`@vue/*`、`typebox` 不打进去，由作者的项目提供同一份。
 * - `index.d.ts`、`browser.d.ts`：打平的类型，不含应用内部的 `nbook/*` 别名，只引用 `vue`、`@vue/reactivity` 与
 *   `typebox`。内核与 nb-form 的子路径映射到源码，类型才会被打进来：经 `node_modules` 解析到的工作区包被 TypeScript
 *   当作外部库，不生成声明。
 * - `build.js`：构建预设（`build-plugin.ts`），在 Node 或 Bun 里运行；Vite、单文件组件编译与图标数据是它的依赖。
 * - `package.json`：版本取产品版本；`vue`、`typebox` 是 peer 依赖，构建预设的工具是普通依赖。
 *
 * 用法：`bun run build:sdk [输出目录]`，缺省输出到 `dist/plugin-sdk/`。
 */

import {readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import vue from "@vitejs/plugin-vue";
import {build as rolldown} from "rolldown";
import {dts} from "rolldown-plugin-dts";
import {build as vite} from "vite";

import {PRODUCT_VERSION} from "../../src/shared/product";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const ENTRIES = {index: join(packageRoot, "src/sdk/index.ts"), browser: join(packageRoot, "src/sdk/browser.ts")};
/** 由作者的项目提供、不打进 SDK 的包：插件运行时宿主给的是同一份。 */
const PEERS = [/^vue($|\/)/u, /^@vue\//u, /^typebox($|\/)/u];
const RUNTIME_SUBPATHS = ["lifecycle", "services", "plugins", "plugin-manifest", "application", "diagnostics", "remote"];

/** 类型打包要的路径映射：应用别名，加上内核与 nb-form 的子路径直接指到源码。 */
function typePaths(): Record<string, string[]> {
    const paths: Record<string, string[]> = {"nbook/*": ["./src/*"]};
    for (const name of RUNTIME_SUBPATHS) paths[`@notnotype/nb-runtime/${name}`] = [`../nb-runtime/src/${name}/${name}.ts`];
    paths["@notnotype/nb-form"] = ["../nb-form/src/index.ts"];
    paths["@notnotype/nb-form/vue"] = ["../nb-form/src/vue/index.ts"];
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

export async function buildSdk(outDir: string): Promise<void> {
    await rm(outDir, {recursive: true, force: true});
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
        external: [...PEERS, /^@notnotype\/nb-ui($|\/)/u],
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.web.json", compilerOptions: {paths: typePaths()}, vue: true, emitDtsOnly: true})],
        output: {dir: outDir},
        // 生成声明本来就慢（vue-tsc），不报插件耗时。
        checks: {pluginTimings: false},
    });
    // 构建预设：Node 工具，打进内核的清单与应用的版本工具；Vite 与编译器、图标数据留作依赖。
    await rolldown({
        cwd: packageRoot,
        input: {build: join(packageRoot, "scripts/plugin-sdk/build-plugin.ts")},
        platform: "node",
        external: [...PEERS, ...BUILD_DEPENDENCIES.map((name) => new RegExp(`^${name.replace("/", "\\/")}($|/)`, "u"))],
        resolve: {alias: {nbook: join(packageRoot, "src")}},
        output: {dir: outDir, format: "es", entryFileNames: "[name].js"},
        checks: {pluginTimings: false},
    });
    const peers = await dependencyRanges(["vue", "typebox"]);
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: "@notnotype/nb-plugin-sdk",
        version: PRODUCT_VERSION,
        description: "NeuroBook 插件 SDK：类型与构建期实现；插件运行时由宿主提供同一份",
        type: "module",
        exports: {
            ".": {types: "./index.d.ts", import: "./index.js"},
            "./browser": {types: "./browser.d.ts", import: "./browser.js"},
            "./build": {import: "./build.js"},
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
