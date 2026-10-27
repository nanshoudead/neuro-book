/**
 * 应用的 npm 包（`scripts/pack-app.ts`）：真实打包两个服务端入口与 `bun pm pack`，Web 产物用一个只有 `index.html` 与许可清单的
 * 目录代替（真实的前端构建与从 tarball 安装、启动、打开作品由 `e2e/app-package.e2e.ts` 验收）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {BUN_ENGINE, PRODUCT_VERSION} from "../src/shared/product";

import {APP_NAME, bundleProblems, packApp} from "./pack-app";

let tmp = "";
let web = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-pack-app", "pack-app");
    web = join(tmp, "web");
    await mkdir(join(web, ".vite"), {recursive: true});
    await writeFile(join(web, "index.html"), "<!doctype html><title>t</title>");
    await writeFile(join(web, ".vite", "license.json"), JSON.stringify([{name: "example-lib", version: "1.2.3", identifier: "MIT", text: "MIT License (example-lib)"}]));
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function tarEntries(tarball: string): string[] {
    const listed = Bun.spawnSync(["tar", "tzf", tarball]);
    if (listed.exitCode !== 0) throw new Error(listed.stderr.toString());
    return listed.stdout.toString().split("\n").filter((line) => line !== "" && !line.endsWith("/")).sort();
}

describe("应用包", () => {
    it("只有白名单里的文件；清单没有依赖、版本是产品版本、bin 是 nbook；许可清单含打进去的包、前端的包与字体", async () => {
        const out = join(tmp, "out", "neuro-book");
        const {directory, tarball} = await packApp({webRoot: web, outDir: out});
        expect(directory).toBe(out);
        expect(tarball).toBe(join(tmp, "out", `notnotype-neuro-book-${PRODUCT_VERSION}.tgz`));
        expect(tarEntries(tarball)).toEqual(["LICENSE", "README.md", "THIRD-PARTY-NOTICES.md", "package.json", "server/nbook.js", "server/project.js", "web/index.html"].map((name) => `package/${name}`).sort());

        const manifest = JSON.parse(await readFile(join(out, "package.json"), "utf8")) as Record<string, unknown>;
        expect(manifest).toMatchObject({name: APP_NAME, version: PRODUCT_VERSION, bin: {nbook: "./server/nbook.js"}, engines: {bun: BUN_ENGINE}, license: "AGPL-3.0-only", publishConfig: {access: "public"}});
        expect(manifest).not.toHaveProperty("dependencies");
        expect(manifest).not.toHaveProperty("private");
        expect((await stat(join(out, "server", "nbook.js"))).mode & 0o111).not.toBe(0);
        expect((await readFile(join(out, "server", "nbook.js"), "utf8")).startsWith("#!/usr/bin/env bun\n")).toBe(true);

        const notices = await readFile(join(out, "THIRD-PARTY-NOTICES.md"), "utf8");
        expect(notices).toContain("### commander@");
        expect(notices).toContain("### example-lib@1.2.3（MIT）");
        expect(notices).toContain("Fraunces");
        const readme = await readFile(join(out, "README.md"), "utf8");
        expect(readme).not.toContain("{{");
        expect(readme).toContain(BUN_ENGINE);

        // 再打一次：上次生成的目录清掉重建。
        expect((await packApp({webRoot: web, outDir: out})).tarball).toBe(tarball);
    }, 60_000);

    it("输出目录不是空的、也不是上次生成的应用包：拒绝，不删里面的东西", async () => {
        const out = join(tmp, "foreign");
        await mkdir(out, {recursive: true});
        await writeFile(join(out, "package.json"), JSON.stringify({name: "something-else"}));
        await expect(packApp({webRoot: web, outDir: out})).rejects.toThrow("不清理");
        expect(JSON.parse(await readFile(join(out, "package.json"), "utf8"))).toEqual({name: "something-else"});
    });

    it("Web 产物没有许可清单：失败，说明要用 vite build 构建", async () => {
        const bare = join(tmp, "bare-web");
        await mkdir(bare, {recursive: true});
        await writeFile(join(bare, "index.html"), "<!doctype html>");
        await expect(packApp({webRoot: bare, outDir: join(tmp, "bare-out")})).rejects.toThrow("vite build");
    });
});

describe("bundle 的核对", () => {
    it("只许 Bun 与 Node 的内置模块；抬头行不影响扫描；运行时按路径找文件的写法也拦下", () => {
        expect(bundleProblems("#!/usr/bin/env bun\nimport {readFile} from \"node:fs/promises\";\nimport fs from \"fs\";\nimport {Database} from \"bun:sqlite\";\n")).toEqual([]);
        expect(bundleProblems("import pad from \"left-pad\";\nimport(\"@scope/thing\");\n")).toEqual(["引用了外部模块 left-pad：依赖要打进 bundle", "引用了外部模块 @scope/thing：依赖要打进 bundle"]);
        expect(bundleProblems("const worker = new Worker(new URL(\"./w.js\", import.meta.url));")).toEqual(["出现了 new Worker(：运行时按路径找文件，装到别处会找不到"]);
    });
});
