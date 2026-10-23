/**
 * 把仓库里的示例插件（`examples/plugins/<名>`）构建成可以安装的插件目录，供 e2e 与手动安装。示例按第三方插件写，只从
 * SDK 包名导入；仓库里没有安装 SDK 包，这里把包名指到应用源码（与 tsconfig、Vite 的别名相同），并把应用源码列为不许打进
 * 产物的目录：示例要是绕过 SDK 直接引用了应用内部，构建就失败。
 *
 * 用法：`bun run build:examples [名…]`，缺省构建全部有 `package.json` 的示例，产物到各自的 `dist/`（git 忽略）。
 */

import {existsSync} from "node:fs";
import {readdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {buildPlugin} from "./build-plugin";
import type {BuildPluginResult} from "./build-plugin";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export const EXAMPLES_ROOT = join(packageRoot, "examples/plugins");

/** 仓库里构建示例的别名与禁止目录。 */
export const IN_REPO_BUILD = {
    alias: [
        {find: /^@notnotype\/nb-plugin-sdk\/browser$/u, replacement: join(packageRoot, "src/sdk/browser.ts")},
        {find: /^@notnotype\/nb-plugin-sdk$/u, replacement: join(packageRoot, "src/sdk/index.ts")},
        {find: /^nbook\//u, replacement: join(packageRoot, "src/")},
    ],
    forbiddenDirectories: [join(packageRoot, "src")],
} as const;

/** 构建一个示例；`outDir` 缺省为它的 `dist/`，构建前清空。 */
export async function buildExample(name: string, outDir: string = join(EXAMPLES_ROOT, name, "dist")): Promise<BuildPluginResult> {
    await rm(outDir, {recursive: true, force: true});
    return buildPlugin({root: join(EXAMPLES_ROOT, name), outDir, ...IN_REPO_BUILD});
}

if (import.meta.main) {
    const requested = process.argv.slice(2);
    const names = requested.length > 0 ? requested : (await readdir(EXAMPLES_ROOT)).filter((name) => existsSync(join(EXAMPLES_ROOT, name, "package.json")));
    for (const name of names) {
        const result = await buildExample(name);
        for (const warning of result.warnings) console.warn(`${name}：${warning}`);
        console.log(`${name}：${result.files.join("、")}`);
    }
}
