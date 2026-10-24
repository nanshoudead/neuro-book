/**
 * 测试里的作者目录：装好 SDK 包与作者机器上要有的包，`package.json` 是作者 `npm install -D <SDK 的 tarball>` 之后会留下的
 * 那样。依赖从仓库的 `node_modules` 链接，不联网；SDK 包从打包产出的 tarball 解开（作者装的就是它）。Bun 的测试与
 * Playwright（Node）都用它，所以只用 Node 的 API。
 */

import {execFileSync} from "node:child_process";
import {mkdir, symlink, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {AUTHOR_PACKAGES, BUILD_DEPENDENCIES} from "../dependencies";

const REPO_MODULES = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));

/** npm 装 vue 时一起装上的包：vue 自己的依赖（`@vue/*`、类型用的 csstype）。 */
const VUE_DEPENDENCIES = ["csstype", ...["reactivity", "runtime-core", "runtime-dom", "shared", "compiler-dom", "compiler-core", "compiler-sfc", "compiler-ssr", "server-renderer"].map((name) => `@vue/${name}`)];

/** 把作者机器上要有的包（加上 `extra`）从仓库的 `node_modules` 链进 `directory/node_modules`。 */
export async function linkAuthorModules(directory: string, extra: ReadonlyArray<string> = []): Promise<void> {
    const modules = join(directory, "node_modules");
    for (const name of [...AUTHOR_PACKAGES, ...BUILD_DEPENDENCIES, ...VUE_DEPENDENCIES, ...extra]) {
        await mkdir(dirname(join(modules, name)), {recursive: true});
        await symlink(join(REPO_MODULES, name), join(modules, name));
    }
}

/** 作者目录：链好依赖，解开 SDK 的 tarball，写下装 SDK 时留下的 `package.json`。 */
export async function authorDirectory(directory: string, tarball: string): Promise<string> {
    await linkAuthorModules(directory);
    const sdk = join(directory, "node_modules/@notnotype/nb-plugin-sdk");
    await mkdir(sdk, {recursive: true});
    // npm 的 tarball 里文件都在 `package/` 下。
    execFileSync("tar", ["-xzf", tarball, "-C", sdk, "--strip-components=1"]);
    await writeFile(join(directory, "package.json"), `${JSON.stringify({devDependencies: {"@notnotype/nb-plugin-sdk": `file:../${basename(tarball)}`}}, null, 2)}\n`);
    return directory;
}

/** 作者目录里 SDK 包的命令。 */
export const cliOf = (directory: string): string => join(directory, "node_modules/@notnotype/nb-plugin-sdk/cli.js");
