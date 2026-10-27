/**
 * 生成应用的 npm 包 `@notnotype/neuro-book`（ADR 0033，docs/specs/runtime/cli.md）：发构建产物，不发源码。
 *
 * - `server/nbook.js`：命令行 `nbook`（`src/cli/main.ts`），里面是整个服务端；`server/project.js`：项目宿主
 *   （`src/project/main.ts`），服务端从 `nbook.js` 旁边找它。两个都由这里用 Bun 打包，依赖全部打进去，包没有 `dependencies`。
 * - `web/`：前端构建产物（`vite build` 的 `dist/web`），不含 Vite 的元数据目录 `.vite/`。
 * - `LICENSE`（仓库根的 AGPL）、给用户的 `README.md`（`scripts/app-package/README.md`，填上 Bun 版本与构建所用的提交）、
 *   `THIRD-PARTY-NOTICES.md`：打进服务端 bundle 的包（按 Bun 的 metafile）与前端产物里的包（Vite 的许可清单）的许可
 *   文本与 NOTICE，加上随 Web 产物分发的 Fraunces 字体的 OFL。打包把各依赖文件头的版权声明去掉了，许可义务靠这份文件履行。
 * - `package.json`：名字、版本（产品版本）、`bin`、`files`、`engines.bun`、`publishConfig` 与 `repository` 按仓库的发布门禁
 *   （`scripts/release/packages.ts`）写，接进发布时不必改产物结构。
 *
 * 打包前核对：两个 bundle 只引用 Bun 与 Node 的内置模块；不出现 `new Worker(` 与 `import.meta.resolve(`（运行时按路径
 * 找文件，装到别处会找不到）；`nbook.js --version` 报的是产品版本。最后 `bun pm pack` 打成 tarball，放在目录旁边。
 * 应用的源码包是 `private`，只有这里生成的目录能发布。
 *
 * 用法：`bun scripts/pack-app.ts [输出目录]`，Web 产物取 `dist/web`（先 `bun run build`），缺省输出到 `dist/app-package/`，
 * 最后一行打印 tarball 的路径。输出目录只在不存在、为空或者是上次生成的应用包时清空重建，否则拒绝。
 */

import {execFile, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {chmod, cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {isBuiltin} from "node:module";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {BUN_ENGINE, PRODUCT_VERSION} from "../src/shared/product";

export const APP_NAME = "@notnotype/neuro-book";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const REPOSITORY = {type: "git", url: "git+https://github.com/notnotype/neuro-book.git", directory: "packages/neuro-book"};
/** 运行时按路径找文件的写法：打包看不见它们要的文件，装到别处就找不到。 */
const FORBIDDEN_TEXT = ["new Worker(", "import.meta.resolve("];
/**
 * 允许的计算出来的动态导入：插件平台装载第三方插件入口（`src/plugin-platform/backend/loader.ts`），路径来自状态根里的安装
 * 目录，不是打包要管的依赖。别的计算出来的 `import(…)` 都拒绝：打包看不见它要的模块。
 */
const ALLOWED_DYNAMIC_IMPORT = "attempt === 0 ? import(file) : import(`${file}?attempt=${String(attempt)}`)";
/** 生成的目录里的标记：只有带它的目录才是上次生成的应用包，可以清空重建。它不在 `files` 里，不进 tarball。 */
const MARKER = ".nbook-app-package";
/** Web 产物里的字体与它们的许可声明（字体不是 JS 模块，Vite 的许可清单不收）。没有登记的字体让打包失败。 */
const FONT_NOTICES: ReadonlyArray<{readonly pattern: RegExp; readonly notice: string}> = [
    {pattern: /^fraunces-latin-[\w-]+\.woff2$/u, notice: "../nb-ui/themes/nbook/assets/fonts/OFL-Fraunces.txt"},
    {pattern: /^codicon-[\w-]+\.ttf$/u, notice: "scripts/app-package/codicon-NOTICE.txt"},
];
const FONT_FILE = /\.(ttf|otf|woff2?)$/u;

export interface PackOptions {
    /** 前端构建产物（`dist/web`），要带 `.vite/license.json`。 */
    readonly webRoot: string;
    readonly outDir: string;
}

export interface PackedApp {
    readonly directory: string;
    readonly tarball: string;
}

/** 清空上次生成的应用包。输出目录来自命令行，传错了不能被递归删除：只认不存在、为空，或者带标记文件的目录。 */
export async function clearPreviousApp(outDir: string): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    const marker = await readFile(join(outDir, MARKER), "utf8").catch(() => null);
    if (marker?.trim() !== APP_NAME) throw new Error(`输出目录 ${outDir} 不是空的，也不是上次生成的 ${APP_NAME}（没有 ${MARKER}），不清理`);
    await rm(outDir, {recursive: true});
}

/** bundle 里不该有的东西：内置模块之外的导入，以及运行时按路径找文件的写法。返回问题列表，空表示通过。 */
export function bundleProblems(source: string): string[] {
    // scanImports 不认文件开头的 shebang，只清掉那一行，行号不变（同 scripts/release/packages.ts）。
    const imports = new Bun.Transpiler({loader: "js"}).scanImports(source.replace(/^#!.*/u, ""));
    const external = imports.map((entry) => entry.path).filter((path) => !path.startsWith("bun:") && path !== "bun" && !isBuiltin(path));
    // scanImports 只报字面的导入；计算出来的 `import(x)` 按文本找：去掉允许的那一处之后，`import(` 后面不是引号的都算。
    const computed = source.replaceAll(ALLOWED_DYNAMIC_IMPORT, "").match(/\bimport\(\s*(?!["'])/gu)?.length ?? 0;
    return [
        ...[...new Set(external)].map((path) => `引用了外部模块 ${path}：依赖要打进 bundle`),
        ...(computed === 0 ? [] : [`有 ${String(computed)} 处计算出来的动态导入：打包看不见它要的模块`]),
        ...FORBIDDEN_TEXT.filter((text) => source.includes(text)).map((text) => `出现了 ${text}：运行时按路径找文件，装到别处会找不到`),
    ];
}

/**
 * 打一个服务端入口，返回打进去的第三方包所在的目录（metafile 的输入里 `node_modules/<包>/` 的那一段）。metafile 的输入路径
 * 相对当前工作目录，不是相对仓库根：从包目录运行时是 `../../node_modules/…`。
 */
async function bundle(entry: string, outFile: string): Promise<Set<string>> {
    const built = await Bun.build({entrypoints: [join(packageRoot, entry)], target: "bun", outdir: dirname(outFile), naming: basename(outFile), metafile: true});
    if (!built.success) throw new AggregateError(built.logs, `打包 ${entry} 失败`);
    const packages = new Set<string>();
    for (const input of Object.keys(built.metafile?.inputs ?? {})) {
        const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(input);
        if (match) packages.add(resolve(match[1]!));
    }
    return packages;
}

interface Notice {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly texts: ReadonlyArray<string>;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotices)(\..*)?$/iu;

/** 一个包目录的许可：`package.json` 的 `license`，加上目录里的 LICENSE、NOTICE 一类文件。两样都没有时失败。 */
async function noticeOf(directory: string): Promise<Notice> {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {name: string; version: string; license?: unknown};
    const files = (await readdir(directory)).filter((name) => LICENSE_FILE.test(name)).sort();
    const texts = await Promise.all(files.map(async (name) => (await readFile(join(directory, name), "utf8")).trim()));
    const license = typeof manifest.license === "string" ? manifest.license : "";
    if (license === "" && texts.length === 0) throw new Error(`${manifest.name}@${manifest.version} 没有写许可：不能把它打进发布的包`);
    return {name: manifest.name, version: manifest.version, license: license || "见下文", texts};
}

interface WebLicense {
    readonly name: string;
    readonly version: string;
    readonly identifier?: string;
    readonly text?: string;
}

async function thirdPartyNotices(serverPackages: ReadonlySet<string>, webRoot: string): Promise<string> {
    const server = await Promise.all([...serverPackages].sort().map(noticeOf));
    const licenseFile = join(webRoot, ".vite", "license.json");
    if (!existsSync(licenseFile)) throw new Error(`${licenseFile} 不存在：前端要用 vite build 构建（vite.config.ts 的 build.license）`);
    const web = (JSON.parse(await readFile(licenseFile, "utf8")) as WebLicense[]).map((entry): Notice => {
        if (!entry.identifier && !entry.text) throw new Error(`前端产物里的 ${entry.name}@${entry.version} 没有写许可`);
        return {name: entry.name, version: entry.version, license: entry.identifier ?? "见下文", texts: entry.text ? [entry.text.trim()] : []};
    });
    // Vite 只收许可文本；包另有的 NOTICE（例如 monaco-editor 的 ThirdPartyNotices，codicon 字体在里面）补上。
    const withNotices = await Promise.all(web.map(async (entry) => {
        const directory = join(repoRoot, "node_modules", entry.name);
        if (!existsSync(directory)) return entry;
        const notices = (await readdir(directory)).filter((name) => /^(notice|thirdpartynotices)(\..*)?$/iu.test(name)).sort();
        return {...entry, texts: [...entry.texts, ...(await Promise.all(notices.map(async (name) => (await readFile(join(directory, name), "utf8")).trim())))]};
    }));
    const fonts = await fontNotices(webRoot);
    const section = (title: string, notices: ReadonlyArray<Notice>): string => [
        `## ${title}`,
        ...notices.map((notice) => [`### ${notice.name}@${notice.version}（${notice.license}）`, ...notice.texts.map((text) => `\`\`\`\n${text}\n\`\`\``)].join("\n\n")),
    ].join("\n\n");
    return [
        "# 第三方许可",
        "这个包里的 `server/` 与 `web/` 是打包产物，打包时去掉了各依赖文件头的版权声明。下面是打进去的每个第三方包的许可与声明。",
        section("服务端（server/nbook.js、server/project.js）", server),
        section("前端（web/）", withNotices),
        ["## 字体", ...fonts.map(({file, text}) => `### web/assets/${file}\n\n\`\`\`\n${text}\n\`\`\``)].join("\n\n"),
    ].join("\n\n") + "\n";
}

/** Web 产物里每个字体文件的许可声明；有没登记的字体时失败。 */
async function fontNotices(webRoot: string): Promise<Array<{readonly file: string; readonly text: string}>> {
    const assets = join(webRoot, "assets");
    const files = existsSync(assets) ? (await readdir(assets)).filter((name) => FONT_FILE.test(name)).sort() : [];
    return Promise.all(files.map(async (file) => {
        const known = FONT_NOTICES.find((entry) => entry.pattern.test(file));
        if (known === undefined) throw new Error(`web/assets/${file} 是没有登记许可的字体：在 scripts/pack-app.ts 的 FONT_NOTICES 里登记它的许可声明`);
        return {file, text: (await readFile(join(packageRoot, known.notice), "utf8")).trim()};
    }));
}

function buildCommit(): string {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {cwd: packageRoot, encoding: "utf8"});
    return result.status === 0 ? result.stdout.trim() : "未知";
}

export async function packApp(options: PackOptions): Promise<PackedApp> {
    const outDir = resolve(options.outDir);
    await clearPreviousApp(outDir);
    if (!existsSync(join(options.webRoot, "index.html"))) throw new Error(`${options.webRoot} 里没有 index.html：先 bun run build`);
    // 标记先于内容写下：中途失败留下的半成品下次照样能被清掉，不用手工删目录。
    await mkdir(outDir, {recursive: true});
    await writeFile(join(outDir, MARKER), `${APP_NAME}\n`);
    const serverPackages = new Set([
        ...await bundle("src/cli/main.ts", join(outDir, "server", "nbook.js")),
        ...await bundle("src/project/main.ts", join(outDir, "server", "project.js")),
    ]);
    await chmod(join(outDir, "server", "nbook.js"), 0o755);
    for (const file of ["nbook.js", "project.js"]) {
        const problems = bundleProblems(await readFile(join(outDir, "server", file), "utf8"));
        if (problems.length > 0) throw new Error(`server/${file} 不能发布：\n${problems.join("\n")}`);
    }
    await cp(options.webRoot, join(outDir, "web"), {recursive: true, filter: (source) => basename(source) !== ".vite"});
    await writeFile(join(outDir, "THIRD-PARTY-NOTICES.md"), await thirdPartyNotices(serverPackages, options.webRoot));
    await cp(join(repoRoot, "LICENSE"), join(outDir, "LICENSE"));
    const readme = (await readFile(join(packageRoot, "scripts/app-package/README.md"), "utf8")).replaceAll("{{bun}}", BUN_ENGINE).replaceAll("{{commit}}", buildCommit());
    await writeFile(join(outDir, "README.md"), readme);
    const description = (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {description: string}).description;
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: APP_NAME,
        version: PRODUCT_VERSION,
        description,
        type: "module",
        bin: {nbook: "./server/nbook.js"},
        files: ["server/", "web/", "LICENSE", "README.md", "THIRD-PARTY-NOTICES.md"],
        engines: {bun: BUN_ENGINE},
        license: "AGPL-3.0-only",
        repository: REPOSITORY,
        publishConfig: {access: "public"},
    }, null, 4)}\n`);
    const version = spawnSync("bun", [join(outDir, "server", "nbook.js"), "--version"], {encoding: "utf8"});
    if (version.status !== 0 || !version.stdout.includes(`NeuroBook ${PRODUCT_VERSION}`)) throw new Error(`server/nbook.js --version 没有报出 ${PRODUCT_VERSION}：${version.stdout}${version.stderr}`);
    const tarball = join(dirname(outDir), `${APP_NAME.replace(/^@/u, "").replace("/", "-")}-${PRODUCT_VERSION}.tgz`);
    await promisify(execFile)("bun", ["pm", "pack", "--quiet", "--filename", tarball], {cwd: outDir});
    if (!existsSync(tarball)) throw new Error(`bun pm pack 没有打出 ${tarball}`);
    return {directory: outDir, tarball};
}

if (import.meta.main) {
    const {directory, tarball} = await packApp({webRoot: join(packageRoot, "dist/web"), outDir: process.argv[2] ?? join(packageRoot, "dist/app-package")});
    console.log(`应用包已生成：${directory}`);
    console.log(tarball);
}
