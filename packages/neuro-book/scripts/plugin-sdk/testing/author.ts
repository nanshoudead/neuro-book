/**
 * 测试里的作者目录：装好生成的 SDK 包与模板要的依赖，`package.json` 是作者 `npm install -D <SDK 的 tarball>` 之后会留下的
 * 那样。依赖从仓库的 `node_modules` 链接，不联网；SDK 包整个复制（作者装的是 tarball 解开的一份，不是链接）。Bun 的测试与
 * Playwright（Node）都用它，所以只用 Node 的 API。
 */

import {cp, mkdir, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const REPO_MODULES = fileURLToPath(new URL("../../../../../node_modules/", import.meta.url));

/** 模板与构建预设在作者机器上要的包。 */
const LINKED = ["vue", "typebox", "typescript", "vue-tsc", "csstype", "vite", "semver", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide"];
const VUE_PACKAGES = ["reactivity", "runtime-core", "runtime-dom", "shared", "compiler-dom", "compiler-core", "compiler-sfc", "compiler-ssr", "server-renderer"];

export async function authorDirectory(directory: string, sdk: string): Promise<string> {
    const modules = join(directory, "node_modules");
    await mkdir(join(modules, "@notnotype"), {recursive: true});
    await cp(sdk, join(modules, "@notnotype/nb-plugin-sdk"), {recursive: true});
    for (const scope of ["@vue", "@vitejs", "@iconify", "@iconify-json"]) await mkdir(join(modules, scope), {recursive: true});
    for (const item of LINKED) await symlink(join(REPO_MODULES, item), join(modules, item));
    for (const item of VUE_PACKAGES) await symlink(join(REPO_MODULES, "@vue", item), join(modules, "@vue", item));
    await writeFile(join(directory, "package.json"), `${JSON.stringify({devDependencies: {"@notnotype/nb-plugin-sdk": "file:../nb-plugin-sdk-0.1.0.tgz"}}, null, 2)}\n`);
    return directory;
}

/** 作者目录里 SDK 包的命令。 */
export const cliOf = (directory: string): string => join(directory, "node_modules/@notnotype/nb-plugin-sdk/cli.js");
