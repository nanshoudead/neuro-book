/**
 * `page:shot` 的参数合同：步骤按命令行里出现的顺序执行，`--path` 只收同源路径。截图本身要真实浏览器与开发服务，
 * 由 Task 验收手动运行（见 AGENTS.md 的命令一节）。
 */

import {describe, expect, it} from "bun:test";

import {pageAddress, PageShotUsageError, parsePageShotArgs} from "./page-shot";

describe("page:shot 参数", () => {
    it("--click 与 --wait-for 交错时按出现的顺序排成步骤；其余取缺省", () => {
        const options = parsePageShotArgs(["--url", "http://127.0.0.1:4217", "--click", "#a", "--wait-for", "#b", "--click", "#c", "--out", "/tmp/x"]);
        expect(options.steps).toEqual([{kind: "click", selector: "#a"}, {kind: "wait-for", selector: "#b"}, {kind: "click", selector: "#c"}]);
        expect(options).toMatchObject({url: "http://127.0.0.1:4217/", path: "/", windowSize: {width: 1440, height: 900}, fullPage: false, scale: 1, theme: null, timeoutMs: 120_000});
    });

    it("--path 带查询串时拼在开发服务地址上", () => {
        expect(pageAddress("http://127.0.0.1:4217/", "/?project=sample")).toBe("http://127.0.0.1:4217/?project=sample");
    });

    for (const path of ["http://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
        it(`--path 不是同源路径时拒绝：${path}`, () => {
            expect(() => parsePageShotArgs(["--url", "http://127.0.0.1:4217/", "--path", path])).toThrow(PageShotUsageError);
        });
    }

    it("缺 --url、未知参数、--theme 取值不对时报用法错误", () => {
        expect(() => parsePageShotArgs([])).toThrow(PageShotUsageError);
        expect(() => parsePageShotArgs(["--url", "http://127.0.0.1:4217/", "--wait", "300"])).toThrow(PageShotUsageError);
        expect(() => parsePageShotArgs(["--url", "http://127.0.0.1:4217/", "--theme", "blue"])).toThrow(PageShotUsageError);
    });
});
