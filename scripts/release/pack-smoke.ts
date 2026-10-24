#!/usr/bin/env bun
/**
 * 发布冒烟（`bun run release:smoke`，ADR 0029、docs/specs/story/cli-skill.md 验收 6）：把发布清单里的包装进仓库外的
 * 空项目，像用户那样用一遍，不调用模型。
 *
 * - 缺省（`--from pack`）：逐个 `bun pm pack`，查包里的文件，再用 `overrides` 让 `@notnotype/*` 全部来自这些 tarball
 *   （它们的版本号还不在 registry 上，有一个漏到 registry 就会装不上）。
 * - `--from registry`：不打包，按 `package.json` 的版本从 registry 装；发布之后在发布用的那个提交上跑一次，作为发布
 *   证据（装上的版本与 checkout 的对不上就失败）。
 *
 * 项目放在系统临时目录下（`@notnotype/neuro-book-test-support/tmp`），不在仓库里：Bun 按目录往上找 `node_modules`，
 * 放在仓库里会用到仓库根提升的依赖，漏写的依赖就查不出来。第三方依赖从 registry 装，直连慢时整条命令前加 `prox`。
 */

import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {basename, join} from "node:path";

import {chromium} from "playwright-core";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {loadReleasePackages, publishOrder, type ReleasePackage} from "#scripts/release/packages";

const REPOSITORY = join(import.meta.dir, "..", "..");

/** 包里不该有的文件。`testing/` 目录是 exports 里公开的测试替身入口，照发。 */
const FORBIDDEN = [/\.test\.tsx?$/u, /\.typecheck\.ts$/u, /\/corpus\//u, /(^|\/)AGENTS\.md$/u, /(^|\/)tsconfig[^/]*\.json$/u, /(^|\/)\.env/u, /^package\/(tests|e2e|playground|docs)\//u, /^package\/src\/web\//u];

type Source = "pack" | "registry";

class SmokeFailure extends Error {}

function step(message: string): void {
    console.log(`✓ ${message}`);
}

function fail(message: string): never {
    throw new SmokeFailure(message);
}

async function run(argv: readonly string[], options: {cwd: string; env?: Record<string, string>}): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn([...argv], {cwd: options.cwd, stdout: "pipe", stderr: "pipe", env: {...process.env, ...options.env}});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

async function mustRun(label: string, argv: readonly string[], options: {cwd: string; env?: Record<string, string>}): Promise<string> {
    const result = await run(argv, options);
    if (result.code !== 0) fail(`${label} 退出码 ${result.code}\n${result.stderr || result.stdout}`);
    return result.stdout;
}

/** 打包一个包并检查里面的文件：不该发的没有，exports 与 bin 指向的文件都在。 */
async function packPackage(entry: ReleasePackage, destination: string): Promise<string> {
    const output = await mustRun(`${entry.manifest.name} 打包`, ["bun", "pm", "pack", "--destination", destination, "--quiet"], {cwd: entry.path});
    const name = output.trim().split("\n").at(-1) as string;
    if (!name.endsWith(".tgz")) fail(`${entry.manifest.name} 打包没有给出 tarball：${output}`);
    const tarball = join(destination, basename(name));
    const listing = (await mustRun("列出包里的文件", ["tar", "-tzf", tarball], {cwd: destination})).trim().split("\n");
    const forbidden = listing.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
    if (forbidden.length > 0) fail(`${entry.manifest.name} 打进了不该发的文件：${forbidden.join("、")}`);
    for (const target of entryTargets(entry)) {
        const pattern = new Bun.Glob(`package/${target.replace(/^\.\//u, "")}`);
        if (!listing.some((file) => pattern.match(file))) fail(`${entry.manifest.name} 的入口 ${target} 不在包里`);
    }
    return tarball;
}

function entryTargets(entry: ReleasePackage): string[] {
    const manifest = entry.manifest as ReleasePackage["manifest"] & {exports?: Record<string, string>; bin?: Record<string, string>};
    return [...Object.values(manifest.exports ?? {}), ...Object.values(manifest.bin ?? {})];
}

/** 让 `@notnotype/*` 来自哪里：打包模式下指向 tarball，registry 模式下写版本号。 */
function sources(packages: readonly ReleasePackage[], tarballs: ReadonlyMap<string, string>): {spec: (name: string) => string; overrides: Record<string, string>; expected: ReadonlyMap<string, string>} {
    const expected = new Map(packages.map((entry) => [entry.manifest.name, entry.manifest.version]));
    const overrides = Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`]));
    return {spec: (name) => overrides[name] ?? (expected.get(name) as string), overrides, expected};
}

/**
 * 装进项目的 `@notnotype/*` 版本必须就是这次要验的版本（当前 checkout 的 package.json）。registry 模式下这把冒烟
 * 绑在发布用的那个提交上：checkout 的版本往前推了，装到的就不是刚发布的那批，这里会报出来。
 */
async function installedVersions(project: string, expected: ReadonlyMap<string, string>): Promise<string> {
    const scope = join(project, "node_modules", "@notnotype");
    const found: string[] = [];
    for (const dir of await readdir(scope)) {
        const {name, version} = JSON.parse(await Bun.file(join(scope, dir, "package.json")).text()) as {name: string; version: string};
        const wanted = expected.get(name);
        if (wanted !== undefined && wanted !== version) fail(`${name} 装上的是 ${version}，要验的是 ${wanted}`);
        found.push(`${name}@${version}`);
    }
    return found.sort().join("、");
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`);
}

async function smokeStory(root: string, from: ReturnType<typeof sources>): Promise<void> {
    const app = join(root, "app");
    await mkdir(app);
    await writeJson(join(app, "package.json"), {name: "nbstory-smoke", private: true, type: "module", dependencies: {"@notnotype/nb-story": from.spec("@notnotype/nb-story")}, overrides: from.overrides});
    await mustRun("安装 nb-story", ["bun", "install"], {cwd: app});
    step(`从包装上 @notnotype/nb-story：${await installedVersions(app, from.expected)}`);

    const nbstory = join(app, "node_modules", ".bin", "nbstory");
    const library = join(root, "library");
    const home = join(root, "home");
    await mkdir(home);
    // HOME 换成临时目录：书库、配置与 Skill 的缺省位置都在它下面，冒烟不碰开发者自己的。
    const env = {HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share")};

    await mustRun("nbstory --help", [nbstory, "--help"], {cwd: app, env});
    const books = JSON.parse(await mustRun("nbstory books", [nbstory, "books", "--library", library, "--json"], {cwd: app, env})) as {ok: boolean};
    if (!books.ok) fail(`nbstory books 没有成功：${JSON.stringify(books)}`);
    step("nbstory --help 与空书库上的 books");

    // config show 会加载 OMP 的模型目录（nb-harness 与它的原生模块）；没写配置时以 qa_unconfigured 退出 1。
    const show = await run([nbstory, "config", "show", "--json"], {cwd: app, env});
    const shown = JSON.parse(show.stdout) as {ok: boolean; error?: {code: string}};
    if (shown.error?.code !== "qa_unconfigured") fail(`nbstory config show 应报 qa_unconfigured：退出码 ${show.code}\n${show.stdout}${show.stderr}`);
    step("nbstory config show 加载模型目录");

    const skills = join(root, "skills");
    const states: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const installed = JSON.parse(await mustRun("nbstory skill install", [nbstory, "skill", "install", "--dir", skills, "--json"], {cwd: app, env})) as {data: {state: string}};
        states.push(installed.data.state);
    }
    if (states.join() !== "installed,unchanged") fail(`skill install 两次应为 installed、unchanged，实际 ${states.join("、")}`);
    if (!(await readdir(join(skills, "nbstory"))).includes("SKILL.md")) fail("装好的 Skill 目录里没有 SKILL.md");
    step("nbstory skill install 两次：installed、unchanged");

    await smokeServe(nbstory, library, app, env);
}

async function smokeServe(nbstory: string, library: string, cwd: string, env: Record<string, string>): Promise<void> {
    const child = Bun.spawn([nbstory, "serve", "--library", library, "--json"], {cwd, stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
    // 服务一启动就归这里收：浏览器起不来、页面断言失败，都要先停服务再把错误抛出去。两边都失败时报先出的那个，
    // 停服的失败只打印。
    let failure: unknown = null;
    try {
        const reader = child.stdout.getReader();
        const first = await reader.read();
        reader.releaseLock();
        const started = JSON.parse(new TextDecoder().decode(first.value ?? new Uint8Array()).trim().split("\n")[0] || "{}") as {ok?: boolean; data?: {login: string}};
        if (!started.ok || !started.data) fail(`nbstory serve 没有启动：${JSON.stringify(started)}\n${await new Response(child.stderr).text()}`);
        await checkPages(started.data.login);
    } catch (error) {
        failure = error;
    }
    try {
        await stopServe(child);
    } catch (error) {
        if (failure === null) throw error;
        console.error(`另外，停服务也失败了：${(error as Error).message}`);
    }
    if (failure !== null) throw failure;
}

async function checkPages(login: string): Promise<void> {
    const browser = await chromium.launch({channel: "chrome", headless: true});
    try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(login);
        await page.getByTestId("go-import").waitFor({timeout: 15_000});
        await page.getByTestId("go-settings").click();
        await page.getByTestId("settings-page").waitFor({timeout: 15_000});
        if (errors.length > 0) fail(`页面有脚本错误：\n${errors.join("\n")}`);
        step("nbstory serve：登录链接打开书架页与设置页，没有脚本错误");
    } finally {
        await browser.close();
    }
}

/** 发 SIGTERM 等它退出；15 秒还没退就 SIGKILL 并报失败（docs/specs/story/cli-skill.md 输出 5：停服退出码 0）。 */
async function stopServe(child: Bun.Subprocess): Promise<void> {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const code = await child.exited;
    clearTimeout(timer);
    if (child.signalCode === "SIGKILL") fail("nbstory serve 收到 SIGTERM 15 秒后还没退出，已强制结束");
    if (code !== 0) fail(`nbstory serve 收到 SIGTERM 后退出码 ${code}`);
    step("nbstory serve 收到 SIGTERM 后以 0 退出");
}

/** 最小的 Vite + Vue + Tailwind 宿主：导入 Vue 包的公开入口与样式入口，构建通过（ADR 0028、0029）。 */
async function smokeVueHost(root: string, from: ReturnType<typeof sources>): Promise<void> {
    const host = join(root, "host");
    await mkdir(join(host, "src"), {recursive: true});
    const libraries = ["@notnotype/nb-ui", "@notnotype/nb-agent-ui", "@notnotype/nb-form", "@notnotype/nb-markdown"];
    await writeJson(join(host, "package.json"), {
        name: "nb-ui-host-smoke",
        private: true,
        type: "module",
        dependencies: {
            ...Object.fromEntries(libraries.map((name) => [name, from.spec(name)])),
            vue: "^3.5.24",
            vite: "^8.1.4",
            "@vitejs/plugin-vue": "^6.0.7",
            tailwindcss: "^4.3.3",
            "@tailwindcss/vite": "^4.3.3",
        },
        overrides: from.overrides,
    });
    await writeFile(join(host, "vite.config.ts"), `import tailwindcss from "@tailwindcss/vite";\nimport vue from "@vitejs/plugin-vue";\nimport {defineConfig} from "vite";\n\nexport default defineConfig({plugins: [vue(), tailwindcss()]});\n`);
    await writeFile(join(host, "index.html"), `<!doctype html>\n<html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`);
    await writeFile(join(host, "src", "style.css"), ['@import "tailwindcss";', '@import "@notnotype/nb-ui/tailwind.css";', '@import "@notnotype/nb-agent-ui/tailwind.css";', '@import "@notnotype/nb-markdown/tailwind.css";', '@source "./**/*.ts";', ""].join("\n"));
    // 整个命名空间都用到，打包器就要编译每一个导出的组件。
    const entries = ["@notnotype/nb-ui", "@notnotype/nb-agent-ui", "@notnotype/nb-agent-ui/vue", "@notnotype/nb-form", "@notnotype/nb-form/vue", "@notnotype/nb-markdown", "@notnotype/nb-markdown/display", "@notnotype/nb-markdown/prompt"];
    await writeFile(
        join(host, "src", "main.ts"),
        [
            `import "./style.css";`,
            `import {createApp, h} from "vue";`,
            ...entries.map((entry, index) => `import * as entry${index} from "${entry}";`),
            `const sizes = [${entries.map((_entry, index) => `Object.keys(entry${index}).length`).join(", ")}];`,
            `createApp({render: () => h("pre", {class: "text-sm"}, JSON.stringify(sizes))}).mount("#app");`,
            "",
        ].join("\n"),
    );
    await mustRun("安装 Vue 宿主", ["bun", "install"], {cwd: host});
    await installedVersions(host, from.expected);
    await mustRun("构建 Vue 宿主", [join(host, "node_modules", ".bin", "vite"), "build"], {cwd: host});
    step(`Vite 宿主导入 ${entries.length} 个公开入口与样式入口，构建通过`);
}

function parseArguments(argv: readonly string[]): {from: Source; keep: boolean} {
    let from: Source = "pack";
    let keep = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--keep") keep = true;
        else if (argument === "--from" && (argv[index + 1] === "pack" || argv[index + 1] === "registry")) from = argv[(index += 1)] as Source;
        else throw new SmokeFailure(`未知参数或取值：${argument}（用法：release:smoke [--from pack|registry] [--keep]）`);
    }
    return {from, keep};
}

if (import.meta.main) {
    let root: string | null = null;
    let keep = false;
    try {
        const options = parseArguments(Bun.argv.slice(2));
        keep = options.keep;
        root = await createTestTmpRoot("release-smoke", "release-smoke");
        const packages = publishOrder(loadReleasePackages(REPOSITORY));
        const tarballs = new Map<string, string>();
        if (options.from === "pack") {
            const destination = join(root, "tarballs");
            await mkdir(destination);
            for (const entry of packages) tarballs.set(entry.manifest.name, await packPackage(entry, destination));
            step(`打包 ${packages.length} 个包，包里的文件与入口检查通过`);
        }
        const from = sources(packages, tarballs);
        await smokeStory(root, from);
        await smokeVueHost(root, from);
        console.log(`发布冒烟通过（${options.from === "pack" ? "本地打包" : "registry"}）`);
    } catch (error) {
        console.error(error instanceof SmokeFailure ? `发布冒烟失败：${error.message}` : error);
        process.exitCode = 1;
    } finally {
        if (root && !keep) await rm(root, {recursive: true, force: true});
        else if (root) console.log(`留下了冒烟目录：${root}`);
    }
}
