/**
 * 内核与应用无关（docs/specs/runtime/plugin-manifest.md 的平台档案）：非测试源码里不写任何应用的名字，注释也不写。哪个应用的
 * 事实（清单的引擎键、保留的发布者）由宿主经平台档案给出；内核自己的命名空间是 `runtime`。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

const SRC = import.meta.dir;
/** 现有的应用名。出现第二个应用时把它的名字加进来。 */
const APP_NAMES = /nbook|neurobook/iu;

function sources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

describe("内核与应用无关", () => {
    it("非测试源码（含注释）不出现应用名", () => {
        const found = sources(SRC).flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (APP_NAMES.test(line) ? [`${relative(SRC, file)}:${String(index + 1)}：${line.trim()}`] : [])));
        expect(found).toEqual([]);
        expect(APP_NAMES.test("const id = \"NeuroBook\";")).toBe(true);
    });
});
