/**
 * 作者工具 `nbook-plugin`（docs/specs/runtime/plugin-api.md 的“作者工具”）：用生成的 SDK 包，在仓库外按作者文档的步骤走一遍。
 * 作者先在新目录里装 SDK（这里写下 `npm install -D <SDK>` 会留下的 `package.json`，依赖从仓库的 `node_modules` 链接，不联网），
 * 再用 Node（不是 Bun）运行包里的 `cli.js`：`create .`、类型检查、`build`、`build --clean --dev`；以及几种拒绝。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {basename, join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {manifestFormat} from "../src/plugin-platform-profile";
import {compareVersions, pluginVersionSatisfies} from "../src/plugin-platform/shared/versions";

import {devVersion} from "./build";

import {authorDirectory, cliOf} from "./testing/author";
import {builtSdk} from "./testing/sdk";

let tmp = "";
/** 测试共用的那份 SDK 包打出的 tarball。 */
let tarball = "";

const authorDirectoryNamed = (name: string): Promise<string> => authorDirectory(join(tmp, name), tarball);

function node(cwd: string, ...args: string[]): {readonly code: number; readonly stdout: string; readonly stderr: string} {
    const result = Bun.spawnSync({cmd: ["node", ...args], cwd, stdout: "pipe", stderr: "pipe"});
    return {code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()};
}

const cli = (cwd: string, ...args: string[]) => node(cwd, cliOf(cwd), ...args);

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "template");
    tarball = (await builtSdk()).tarball;
}, 240_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("nbook-plugin", () => {
    it("create . 在装好 SDK 的目录里写出模板、合并 package.json；生成的插件能类型检查、构建，清单合格；build --clean --dev 给出开发版本", async () => {
        const author = await authorDirectoryNamed("hello-world");
        const created = cli(author, "create", ".");
        expect(created.stderr).toBe("");
        expect(created.code).toBe(0);
        expect(created.stdout).toContain("my.hello-world");

        const manifest = JSON.parse(await readFile(join(author, "package.json"), "utf8")) as Record<string, Record<string, string> | string>;
        expect(manifest).toMatchObject({publisher: "my", name: "hello-world", version: "0.1.0", scripts: {build: "nbook-plugin build --clean"}});
        // 装 SDK 时写下的依赖写法不动，模板补上缺的开发依赖。
        expect((manifest.devDependencies as Record<string, string>)["@notnotype/nb-plugin-sdk"]).toBe(`file:../${basename(tarball)}`);
        expect(Object.keys(manifest.devDependencies as Record<string, string>).sort()).toEqual(["@notnotype/nb-plugin-sdk", "typebox", "typescript", "vue", "vue-tsc"]);
        expect(await readdir(author)).toEqual(expect.arrayContaining([".gitignore", "README.md", "env.d.ts", "plugin.ts", "shared", "tsconfig.json", "web"]));

        const checked = node(author, join(author, "node_modules/vue-tsc/bin/vue-tsc.js"), "--noEmit", "-p", author);
        expect(`${checked.stdout}${checked.stderr}`).toBe("");
        expect(checked.code).toBe(0);

        const built = cli(author, "build");
        expect(built.stderr).toBe("");
        expect(built.code).toBe(0);
        const result = manifestFormat.read(JSON.parse(await readFile(join(author, "dist/package.json"), "utf8")));
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
        const author = await authorDirectoryNamed("clean-guard");
        expect(cli(author, "create", ".").code).toBe(0);
        const other = join(tmp, "not-a-build");
        await mkdir(other, {recursive: true});
        await writeFile(join(other, "notes.txt"), "我的笔记");
        const result = cli(author, "build", "--clean", "--out", other);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("不清理");
        expect(await readdir(other)).toEqual(["notes.txt"]);
    }, 120_000);

    it("create 拒绝：目录里已有别的文件（一个文件都不写）、名字以数字开头（写明规则）、publisher 是 nbook；写到一半失败时目录回到原样；用法不对退出码 2", async () => {
        const busy = await authorDirectoryNamed("busy");
        await writeFile(join(busy, "index.ts"), "export {};\n");
        const refused = cli(busy, "create", ".");
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("index.ts");
        expect((await readdir(busy)).sort()).toEqual(["index.ts", "node_modules", "package.json"]);

        const digits = cli(busy, "create", join(tmp, "2048-timer"));
        expect(digits.code).toBe(1);
        expect(digits.stderr).toContain("字母开头");
        expect(await readdir(tmp)).not.toContain("2048-timer");

        const builtin = cli(busy, "create", join(tmp, "reserved"), "--publisher", "nbook");
        expect(builtin.code).toBe(1);
        expect(builtin.stderr).toContain("publisher 不能是 nbook");
        expect(await readdir(tmp)).not.toContain("reserved");

        // package.json 只读：写到它时失败。之前写下的文件与目录撤掉，package.json 原样，报一行原因、不打栈。
        const locked = await authorDirectoryNamed("locked");
        const before = await readFile(join(locked, "package.json"), "utf8");
        await chmod(join(locked, "package.json"), 0o444);
        const failed = cli(locked, "create", ".");
        await chmod(join(locked, "package.json"), 0o644);
        expect(failed.code).toBe(1);
        expect(failed.stderr).toContain("写插件目录失败");
        expect(failed.stderr).toContain("已撤掉这次写下的文件");
        expect(failed.stderr).not.toContain("    at ");
        expect((await readdir(locked)).sort()).toEqual(["node_modules", "package.json"]);
        expect(await readFile(join(locked, "package.json"), "utf8")).toBe(before);
        expect(cli(locked, "create", ".").code).toBe(0);

        expect(cli(busy, "create").code).toBe(2);
        expect(cli(busy, "publish").code).toBe(2);
    }, 120_000);

    it("create 到空目录：SDK 依赖写成 registry 版本时提示先装 tarball；给了 --sdk 就按它写", async () => {
        const runner = await authorDirectoryNamed("runner");
        const fresh = cli(runner, "create", join(tmp, "fresh"));
        expect(fresh.code).toBe(0);
        expect(fresh.stderr).toContain("SDK 还没有发布");
        const pinned = cli(runner, "create", join(tmp, "pinned"), "--sdk", "file:/opt/nb-plugin-sdk-0.1.0.tgz");
        expect(pinned.code).toBe(0);
        expect(pinned.stderr).toBe("");
        expect(cli(runner, "create", join(tmp, "latest"), "--sdk", "latest").stderr).toContain("SDK 还没有发布");
        expect((JSON.parse(await readFile(join(tmp, "pinned/package.json"), "utf8")) as {devDependencies: Record<string, string>}).devDependencies["@notnotype/nb-plugin-sdk"]).toBe("file:/opt/nb-plugin-sdk-0.1.0.tgz");
    }, 120_000);

    it("create 合并 npm init 写下的 package.json：type、version 用模板的，作者的 test 脚本保留；name 不合规时提示 --name", async () => {
        const author = await authorDirectoryNamed("npm-init");
        await writeFile(join(author, "package.json"), JSON.stringify({name: "npm-init", version: "1.0.0", type: "commonjs", scripts: {test: "echo no test"}, devDependencies: {"@notnotype/nb-plugin-sdk": "file:../sdk.tgz"}}));
        expect(cli(author, "create", ".").code).toBe(0);
        const manifest = JSON.parse(await readFile(join(author, "package.json"), "utf8")) as Record<string, unknown>;
        expect(manifest).toMatchObject({name: "npm-init", version: "0.1.0", type: "module", scripts: {test: "echo no test", build: "nbook-plugin build --clean"}});

        // `npm init -y` 留下的占位去掉：指向不存在文件的 main、缺省的报错测试脚本、空的 keywords 与 author。
        const initialized = await authorDirectoryNamed("npm-init-y");
        await writeFile(join(initialized, "package.json"), JSON.stringify({name: "npm-init-y", version: "1.0.0", main: "index.js", scripts: {test: 'echo "Error: no test specified" && exit 1'}, keywords: [], author: "", license: "ISC", devDependencies: {"@notnotype/nb-plugin-sdk": "file:../sdk.tgz"}}));
        expect(cli(initialized, "create", ".").code).toBe(0);
        const cleaned = JSON.parse(await readFile(join(initialized, "package.json"), "utf8")) as Record<string, unknown>;
        expect(cleaned).not.toHaveProperty("main");
        expect(cleaned).not.toHaveProperty("keywords");
        expect(cleaned).not.toHaveProperty("author");
        expect(cleaned).toMatchObject({license: "ISC"});
        expect((cleaned.scripts as Record<string, string>).test).toBeUndefined();

        const scoped = await authorDirectoryNamed("scoped");
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
