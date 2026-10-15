/**
 * `page:shot` 的参数与退出码合同：步骤按命令行里出现的顺序执行，`--path` 只收同源路径，停在宿主失败页的失败与截图过程的
 * 失败分开报。截图本身要真实浏览器与开发服务，由 Task 验收手动运行（见 AGENTS.md 的命令一节）。
 */

import {describe, expect, it} from "bun:test";

import {exitCodeOf, pageAddress, PageShotUsageError, parsePageShotArgs} from "./page-shot";
import type {PageShotOptions, PageShotReport} from "./page-shot";

function parse(args: readonly string[]): PageShotOptions {
    const options = parsePageShotArgs(args);
    if (options === null) throw new Error("要的是用法，不是截图参数");
    return options;
}

describe("page:shot 参数", () => {
    it("--click 与 --wait-for 交错时按出现的顺序排成步骤；其余取缺省", () => {
        const options = parse(["--url", "http://127.0.0.1:4217", "--click", "#a", "--wait-for", "#b", "--click", "#c", "--out", "/tmp/x"]);
        expect(options.steps).toEqual([{kind: "click", selector: "#a"}, {kind: "wait-for", selector: "#b"}, {kind: "click", selector: "#c"}]);
        expect(options).toMatchObject({url: "http://127.0.0.1:4217/", path: "/", windowSize: {width: 1440, height: 900}, fullPage: false, scale: 1, theme: null, timeoutMs: 120_000, allowHostFailure: false});
    });

    it("--allow-host-failure 是开关，不吃后面的参数", () => {
        expect(parse(["--allow-host-failure", "--url", "http://127.0.0.1:4217/"]).allowHostFailure).toBe(true);
    });

    it("--help 与 -h 要的是用法，不管别的参数", () => {
        expect(parsePageShotArgs(["--help"])).toBeNull();
        expect(parsePageShotArgs(["--url", "http://127.0.0.1:4217/", "-h"])).toBeNull();
    });

    it("--url 不是有效地址时报用法错误，写明参数与收到的值", () => {
        expect(() => parsePageShotArgs(["--url", "nonsense"])).toThrow(PageShotUsageError);
        expect(() => parsePageShotArgs(["--url", "nonsense"])).toThrow(/--url .*收到：nonsense/u);
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

describe("page:shot 退出码", () => {
    const report = (patch: Partial<PageShotReport>): PageShotReport => ({
        url: "http://127.0.0.1:4217/", window: {width: 1440, height: 900}, steps: [], hostStatus: null, hostReason: null, failedAtHostPage: false,
        persistentAnimations: [], file: "/tmp/x/page.png", problems: [], error: null, ...patch,
    });

    it("截好了是 0，带着失败页照常截图（--allow-host-failure）也是 0", () => {
        expect(exitCodeOf(report({}))).toBe(0);
        expect(exitCodeOf(report({hostStatus: "connection-failed"}))).toBe(0);
    });

    it("停在宿主失败页是 2，截图过程失败是 1", () => {
        expect(exitCodeOf(report({hostStatus: "project-unavailable", failedAtHostPage: true, error: "页面停在宿主的失败页 project-unavailable"}))).toBe(2);
        expect(exitCodeOf(report({error: "画面 4 秒内没有稳定下来"}))).toBe(1);
    });
});
