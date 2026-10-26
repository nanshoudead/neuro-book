import {describe, expect, test} from "bun:test";
import {highlightParts, snippetAround} from "../src/web/host/highlight.js";

/** 搜索结果的关键词高亮与内容片段（`host/highlight.ts`，t15 阶段 4 第 5 批）。 */
describe("高亮", () => {
    test("不分大小写切出每一处命中；正则的特殊字符按字面；空搜索词不切", () => {
        expect(highlightParts("Panel 与 panel、PANEL", "panel")).toEqual([
            {text: "Panel", hit: true}, {text: " 与 ", hit: false}, {text: "panel", hit: true}, {text: "、", hit: false}, {text: "PANEL", hit: true},
        ]);
        expect(highlightParts("a.b 与 aXb", "a.b")).toEqual([{text: "a.b", hit: true}, {text: " 与 aXb", hit: false}]);
        expect(highlightParts("没有", "面板")).toEqual([{text: "没有", hit: false}]);
        expect(highlightParts("原样", "  ")).toEqual([{text: "原样", hit: false}]);
    });

    test("命中在很后面时片段从命中前 30 个字开始、前面加省略号；去掉缩进", () => {
        const long = `${"x".repeat(80)}needle 后面`;
        expect(snippetAround(long, "needle")).toBe(`…${"x".repeat(30)}needle 后面`);
        expect(snippetAround("    短的 needle", "needle")).toBe("短的 needle");
    });

    test("片段按字素切：emoji 的代理对与带组合符号的字不会被切开（第 5 批前端审查第 6 条）", () => {
        const emoji = snippetAround(`${"😀".repeat(40)}needle`, "needle", 31);
        expect(emoji).toBe(`…${"😀".repeat(31)}needle`);
        expect(emoji.includes("\ufffd") || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(emoji)).toBe(false);
        const accent = snippetAround(`${"x".repeat(10)}e\u0301${"y".repeat(29)}needle`, "needle", 30);
        expect(accent).toBe(`…e\u0301${"y".repeat(29)}needle`);
        expect(snippetAround("短的 needle", "needle", 30)).toBe("短的 needle");
    });
});
