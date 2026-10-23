/**
 * 包的依赖边界（packages/nb-markdown/AGENTS.md）：纯 TS 入口（`src/` 根上的文件）只引 `entities`，后端的字数也用它；
 * 全包不引宿主的源码（`nbook/…` 应用别名、跨包相对路径）与插件内核；源码里 import 的第三方包都要在 package.json 里声明
 * （仓库根目录把依赖全部提升，漏声明时本机照样能跑）。扫描的写法见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const PACKAGE_JSON = JSON.parse(readFileSync(join(SOURCE_ROOT, "..", "package.json"), "utf8")) as {dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; devDependencies?: Record<string, string>};

/** 包名本身与它的子路径：`@tiptap/pm` 也认 `@tiptap/pm/model`。 */
const exactly = (name: string): RegExp => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/.*)?$`, "u");
const DECLARED = Object.keys({...PACKAGE_JSON.dependencies, ...PACKAGE_JSON.peerDependencies}).map(exactly);
/** 只给类型检查用的（端口的类型断言引 nb-agent-ui）：只许 `import type`。 */
const DEV_ONLY = Object.keys(PACKAGE_JSON.devDependencies ?? {}).map(exactly);

/** 纯 TS 入口：`src/` 根上的文件；它们之间互相引用，不引子目录。 */
const coreFiles = readdirSync(SOURCE_ROOT, {withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")).map((entry) => join(SOURCE_ROOT, entry.name));

describe("包的导入", () => {
    it("纯 TS 入口只引 entities 与 src 根上的文件，编辑内核只许 import type", () => {
        const core: ImportRule = {packages: [/^entities$/u], typeOnly: [/^@tiptap\//u, /^marked$/u], within: SOURCE_ROOT};
        expect(scanImports(coreFiles, core)).toEqual([]);
        const intoSubdirectories = coreFiles.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/from\s*"(\.\/[^"]+\/[^"]+)"/gu)].map((match) => `${file}: ${match[1]}`));
        expect(intoSubdirectories).toEqual([]);
    });

    it("全包只引 package.json 里声明的包与本包的文件（宿主源码与插件内核都不在声明里），开发依赖只许 import type", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT), {packages: DECLARED, typeOnly: DEV_ONLY, within: SOURCE_ROOT})).toEqual([]);
    });
});
