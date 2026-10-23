/**
 * 作者命令 `nbook-plugin`（docs/specs/runtime/plugin-api.md 的“作者工具”），SDK 包的 bin：`build:sdk` 把它打包成 `cli.js`，
 * 模板目录 `template/` 放在它旁边。在 Node 与 Bun 里都能运行，所以不用 `import.meta.main`（Node 24.2 之前没有）：这个模块
 * 只作命令入口，被导入就会执行。
 *
 * 退出码：0 成功（构建只有警告时也是 0，警告打到标准错误）；1 构建或生成失败，标准错误逐行列出问题；2 用法不对。
 */

import {existsSync} from "node:fs";
import {readdir, readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {PRODUCT_VERSION} from "../../src/shared/product";

import {buildPlugin, devVersion, isPreviousBuild, PluginBuildError} from "./build-plugin";
import {createPlugin, PluginCreateError} from "./create-plugin";

const USAGE = `用法：
  nbook-plugin create <目录> [--publisher <段>] [--name <段>] [--sdk <依赖写法>]
  nbook-plugin build [作者目录，缺省 .] [--out <目录>，缺省 <作者目录>/dist] [--clean] [--dev]`;

class UsageError extends Error {}

async function create(args: ReadonlyArray<string>): Promise<number> {
    const {values, positionals} = parseArgs({args: [...args], options: {publisher: {type: "string"}, name: {type: "string"}, sdk: {type: "string"}}, allowPositionals: true});
    const directory = positionals[0];
    if (directory === undefined || positionals.length > 1) throw new UsageError("create 要一个目录");
    const result = await createPlugin({
        directory,
        ...(values.publisher === undefined ? {} : {publisher: values.publisher}),
        ...(values.name === undefined ? {} : {name: values.name}),
        ...(values.sdk === undefined ? {} : {sdk: values.sdk}),
        templateDir: fileURLToPath(new URL("./template/", import.meta.url)),
        sdkVersion: PRODUCT_VERSION,
    });
    console.log(`已生成插件 ${result.id}：${result.directory}`);
    if (result.sdkFromRegistry) {
        console.error("注意：SDK 还没有发布到 npm，package.json 里的 SDK 依赖装不上。先在插件目录里 npm install -D <SDK 的 tarball 路径>，或重新运行 create 并加 --sdk file:<tarball 路径>。");
    }
    console.log("下一步：");
    console.log(`  cd ${result.directory}`);
    console.log("  npm install          # 装上模板补的依赖");
    console.log("  npm run build        # 产物在 dist/");
    console.log(`  在 NeuroBook 的“设置 → 插件”里点“安装…”，填 ${join(result.directory, "dist")}，确认后重启`);
    return 0;
}

async function build(args: ReadonlyArray<string>): Promise<number> {
    const {values, positionals} = parseArgs({args: [...args], options: {out: {type: "string"}, clean: {type: "boolean"}, dev: {type: "boolean"}}, allowPositionals: true});
    if (positionals.length > 1) throw new UsageError("build 至多一个作者目录");
    const root = resolve(positionals[0] ?? ".");
    const outDir = values.out === undefined ? join(root, "dist") : resolve(values.out);
    if (values.clean === true && existsSync(outDir) && (await readdir(outDir)).length > 0) {
        // 只删这个插件上次的产物：`--out` 写错成别的目录时不能把它清空。
        if (!(await isPreviousBuild(root, outDir))) throw new PluginBuildError("输出目录里不是这个插件上次的产物，不清理", [{path: "", message: outDir}]);
        await rm(outDir, {recursive: true});
    }
    const version = values.dev === true ? devVersion(await authorVersion(root), new Date()) : undefined;
    const result = await buildPlugin({root, outDir, ...(version === undefined ? {} : {version})});
    for (const warning of result.warnings) console.error(`警告：${warning}`);
    console.log(`已构建 ${String(result.manifest.publisher)}.${String(result.manifest.name)}@${String(result.manifest.version)}：${outDir}（${result.files.join("、")}）`);
    return 0;
}

async function authorVersion(root: string): Promise<string> {
    try {
        const value = (JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: unknown} | null)?.version;
        if (typeof value === "string") return value;
    } catch (error) {
        throw new PluginBuildError("读不了 package.json", [{path: "", message: `${join(root, "package.json")}：${error instanceof Error ? error.message : String(error)}`}], {cause: error});
    }
    throw new PluginBuildError("package.json 没有 version", [{path: "version", message: "要写插件的版本"}]);
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
    const [command, ...rest] = argv;
    try {
        if (command === "create") return await create(rest);
        if (command === "build") return await build(rest);
        if (command === "--help" || command === "-h" || command === "help") {
            console.log(USAGE);
            return 0;
        }
        throw new UsageError(command === undefined ? "缺少子命令" : `不认识的子命令：${command}`);
    } catch (error) {
        if (error instanceof PluginBuildError) {
            console.error(error.summary);
            for (const problem of error.problems) console.error(`  ${problem.path === "" ? problem.message : `${problem.path}：${problem.message}`}`);
            return 1;
        }
        if (error instanceof PluginCreateError) {
            console.error(error.message);
            return 1;
        }
        // parseArgs 的用法错误带 `ERR_PARSE_ARGS_*` 码（不认识的开关、开关少了值）。
        if (error instanceof UsageError || (error instanceof TypeError && String((error as {code?: unknown}).code).startsWith("ERR_PARSE_ARGS_"))) {
            console.error(error.message);
            console.error(USAGE);
            return 2;
        }
        // 文件系统的错误（读不了目录、没有权限、磁盘满）：给一行原因，不打栈。
        if (error instanceof Error && typeof (error as NodeJS.ErrnoException).syscall === "string") {
            console.error(error.message);
            return 1;
        }
        throw error;
    }
}

process.exitCode = await main(process.argv.slice(2));
