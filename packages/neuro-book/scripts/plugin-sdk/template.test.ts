/**
 * 作者工具 `nbook-plugin`（docs/specs/runtime/plugin-api.md 的“作者工具”）：用生成的 SDK 包，在仓库外按作者文档的步骤走一遍。
 * 作者先在新目录里装 SDK（这里写下 `npm install -D <SDK>` 会留下的 `package.json`，依赖从仓库的 `node_modules` 链接，不联网），
 * 再用 Node（不是 Bun）运行包里的 `cli.js`：`create .`、类型检查、`build`、`build --clean --dev`；以及几种拒绝。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {cp, mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {compareVersions, npmVersions, pluginVersionSatisfies} from "../../src/shared/versions";

import {devVersion} from "./build-plugin";

import {buildSdk} from "./build-sdk";

const repoModules = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));
let tmp = "";
let sdk = "";

/** 作者目录：装好了 SDK 与模板要的依赖（链接到仓库里同一份），`package.json` 是 `npm install -D <SDK>` 写下的那样。 */
async function authorDirectory(name: string): Promise<string> {
    const directory = join(tmp, name);
    const modules = join(directory, "node_modules");
    await mkdir(join(modules, "@notnotype"), {recursive: true});
    await cp(sdk, join(modules, "@notnotype/nb-plugin-sdk"), {recursive: true});
    for (const scope of ["@vue", "@vitejs", "@iconify", "@iconify-json"]) await mkdir(join(modules, scope), {recursive: true});
    for (const item of ["vue", "typebox", "typescript", "vue-tsc", "csstype", "vite", "semver", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide"]) {
        await symlink(join(repoModules, item), join(modules, item));
    }
    for (const item of ["reactivity", "runtime-core", "runtime-dom", "shared", "compiler-dom", "compiler-core", "compiler-sfc", "compiler-ssr", "server-renderer"]) {
        await symlink(join(repoModules, "@vue", item), join(modules, "@vue", item));
    }
    await writeFile(join(directory, "package.json"), `${JSON.stringify({devDependencies: {"@notnotype/nb-plugin-sdk": "file:../nb-plugin-sdk-0.1.0.tgz"}}, null, 2)}\n`);
    return directory;
}

function node(cwd: string, ...args: string[]): {readonly code: number; readonly stdout: string; readonly stderr: string} {
    const result = Bun.spawnSync({cmd: ["node", ...args], cwd, stdout: "pipe", stderr: "pipe"});
    return {code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()};
}

const cli = (cwd: string, ...args: string[]) => node(cwd, join(cwd, "node_modules/@notnotype/nb-plugin-sdk/cli.js"), ...args);

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "template");
    sdk = join(tmp, "sdk");
    await buildSdk(sdk);
}, 120_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("nbook-plugin", () => {
    it("create . 在装好 SDK 的目录里写出模板、合并 package.json；生成的插件能类型检查、构建，清单合格；build --clean --dev 给出开发版本", async () => {
        const author = await authorDirectory("hello-world");
        const created = cli(author, "create", ".");
        expect(created.stderr).toBe("");
        expect(created.code).toBe(0);
        expect(created.stdout).toContain("my.hello-world");

        const manifest = JSON.parse(await readFile(join(author, "package.json"), "utf8")) as Record<string, Record<string, string> | string>;
        expect(manifest).toMatchObject({publisher: "my", name: "hello-world", version: "0.1.0", scripts: {build: "nbook-plugin build --clean"}});
        // 装 SDK 时写下的依赖写法不动，模板补上缺的开发依赖。
        expect((manifest.devDependencies as Record<string, string>)["@notnotype/nb-plugin-sdk"]).toBe("file:../nb-plugin-sdk-0.1.0.tgz");
        expect(Object.keys(manifest.devDependencies as Record<string, string>).sort()).toEqual(["@notnotype/nb-plugin-sdk", "typebox", "typescript", "vue", "vue-tsc"]);
        expect(await readdir(author)).toEqual(expect.arrayContaining([".gitignore", "README.md", "env.d.ts", "plugin.ts", "shared", "tsconfig.json", "web"]));

        const checked = node(author, join(author, "node_modules/vue-tsc/bin/vue-tsc.js"), "--noEmit", "-p", author);
        expect(`${checked.stdout}${checked.stderr}`).toBe("");
        expect(checked.code).toBe(0);

        const built = cli(author, "build");
        expect(built.stderr).toBe("");
        expect(built.code).toBe(0);
        const result = readPluginManifest(JSON.parse(await readFile(join(author, "dist/package.json"), "utf8")), {versions: npmVersions});
        if (result.status !== "valid") throw new Error(JSON.stringify(result.problems));
        expect(result.manifest.id).toBe("my.hello-world");
        expect(result.manifest.entries.map((entry) => [entry.id, entry.activationEvents])).toEqual([["browser", ["onStartup"]]]);
        expect(result.manifest.entries[0]!.contributes.map((item) => item.id).sort()).toEqual(["my.hello-world.hello", "my.hello-world.say-hello"]);
        expect(await readdir(join(author, "dist"))).toEqual(expect.arrayContaining(["browser.js", "package.json", "style.css"]));

        // dist 里是上次的产物：不带 --clean 时拒绝，带 --clean 时清空重建。
        const again = cli(author, "build");
        expect(again.code).toBe(1);
        expect(again.stderr).toContain("输出目录不是空的");
        const dev = cli(author, "build", "--clean", "--dev");
        expect(dev.code).toBe(0);
        // 开发版本带构建元数据：插件页按升级处理，依赖它的插件写的 ^0.1.0 照样接受（devVersion 的注释）。
        const devBuilt = (JSON.parse(await readFile(join(author, "dist/package.json"), "utf8")) as {version: string}).version;
        expect(devBuilt).toMatch(/^0\.1\.0\+dev\.\d{14}\.\d{1,3}$/u);
        expect(compareVersions(devBuilt, "0.1.0")).toBeGreaterThan(0);
        expect(pluginVersionSatisfies(devBuilt, "^0.1.0")).toBe(true);
    }, 240_000);

    it("--clean 的输出目录不是这个插件上次的产物：拒绝，里面的文件还在", async () => {
        const author = await authorDirectory("clean-guard");
        expect(cli(author, "create", ".").code).toBe(0);
        const other = join(tmp, "not-a-build");
        await mkdir(other, {recursive: true});
        await writeFile(join(other, "notes.txt"), "我的笔记");
        const result = cli(author, "build", "--clean", "--out", other);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("不清理");
        expect(await readdir(other)).toEqual(["notes.txt"]);
    }, 120_000);

    it("create 拒绝：目录里已有别的文件（一个文件都不写）、名字以数字开头（写明规则）；用法不对退出码 2", async () => {
        const busy = await authorDirectory("busy");
        await writeFile(join(busy, "index.ts"), "export {};\n");
        const refused = cli(busy, "create", ".");
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("index.ts");
        expect((await readdir(busy)).sort()).toEqual(["index.ts", "node_modules", "package.json"]);

        const digits = cli(busy, "create", join(tmp, "2048-timer"));
        expect(digits.code).toBe(1);
        expect(digits.stderr).toContain("以小写字母开头");
        expect(await readdir(tmp)).not.toContain("2048-timer");

        expect(cli(busy, "create").code).toBe(2);
        expect(cli(busy, "publish").code).toBe(2);
    }, 120_000);

    it("create 到空目录：SDK 依赖写成 registry 版本时提示先装 tarball；给了 --sdk 就按它写", async () => {
        const runner = await authorDirectory("runner");
        const fresh = cli(runner, "create", join(tmp, "fresh"));
        expect(fresh.code).toBe(0);
        expect(fresh.stderr).toContain("SDK 还没有发布");
        const pinned = cli(runner, "create", join(tmp, "pinned"), "--sdk", "file:/opt/nb-plugin-sdk-0.1.0.tgz");
        expect(pinned.code).toBe(0);
        expect(pinned.stderr).toBe("");
        expect((JSON.parse(await readFile(join(tmp, "pinned/package.json"), "utf8")) as {devDependencies: Record<string, string>}).devDependencies["@notnotype/nb-plugin-sdk"]).toBe("file:/opt/nb-plugin-sdk-0.1.0.tgz");
    }, 120_000);

    it("create 合并 npm init 写下的 package.json：type、version 用模板的，作者的 test 脚本保留；name 不合规时提示 --name", async () => {
        const author = await authorDirectory("npm-init");
        await writeFile(join(author, "package.json"), JSON.stringify({name: "npm-init", version: "1.0.0", type: "commonjs", scripts: {test: "echo no test"}, devDependencies: {"@notnotype/nb-plugin-sdk": "file:../sdk.tgz"}}));
        expect(cli(author, "create", ".").code).toBe(0);
        const manifest = JSON.parse(await readFile(join(author, "package.json"), "utf8")) as Record<string, unknown>;
        expect(manifest).toMatchObject({name: "npm-init", version: "0.1.0", type: "module", scripts: {test: "echo no test", build: "nbook-plugin build --clean"}});

        const scoped = await authorDirectory("scoped");
        await writeFile(join(scoped, "package.json"), JSON.stringify({name: "@me/scoped"}));
        const refused = cli(scoped, "create", ".");
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("--name");
    }, 120_000);

    it("开发版本每次构建都比上一次新，同一秒里也分得出先后", () => {
        const first = devVersion("0.1.0", new Date("2026-10-23T18:15:00.123Z"));
        const second = devVersion("0.1.0", new Date("2026-10-23T18:15:00.124Z"));
        expect(first).toBe("0.1.0+dev.20261023181500.123");
        expect(compareVersions(second, first)).toBeGreaterThan(0);
        expect(compareVersions(devVersion("0.1.0", new Date("2026-10-23T18:15:01.001Z")), second)).toBeGreaterThan(0);
    });
});
