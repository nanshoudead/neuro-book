/** 源码编辑器交出正文时的按行三方合并（docs/specs/workbench/editor.md 输出 19）：只把改过的行换成模型的文本，其余行连同换行符保持原文。 */

import {describe, expect, it} from "bun:test";

import {mergeSource} from "./source-merge";

describe("按行三方合并", () => {
    it("theirs 与 base 相同：原样返回原文", () => {
        expect(mergeSource("* a\r\n* b\r\n", "- a\n- b\n", "- a\n- b\n")).toBe("* a\r\n* b\r\n");
    });

    it("只把编辑过的行换成编辑器的写法；规范化造成的差异保留原文；原文的换行符逐行保留，新行用主导换行符", () => {
        const ours = "* 甲\r\n* 乙\r\n\r\n第一段\r\n\r\n第二段\r\n";
        const base = "- 甲\n- 乙\n\n第一段\n\n第二段\n";
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第一段（改）\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第一段（改）\r\n\r\n第二段\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第一段\n\n新段\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第一段\r\n\r\n新段\r\n\r\n第二段\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 乙\n\n第二段\n")).toBe("* 甲\r\n* 乙\r\n\r\n第二段\r\n");
    });

    it("换行符混用的原文：没改的行各自保留自己的换行符", () => {
        expect(mergeSource("a\r\nb\nc\r\nd\r\n", "a\nb\nc\nd", "a\nb\nc\nD")).toBe("a\r\nb\nc\r\nD\r\n");
    });

    it("连续的规范化行里改、删、插一行：只有那一行换成编辑器的写法，相邻的未编辑行保持原文", () => {
        const ours = "* 甲\r\n* 乙\r\n* 丙\r\n";
        const base = "- 甲\n- 乙\n- 丙";
        expect(mergeSource(ours, base, "- 甲\n- 乙改\n- 丙")).toBe("* 甲\r\n- 乙改\r\n* 丙\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 丙")).toBe("* 甲\r\n* 丙\r\n");
        expect(mergeSource(ours, base, "- 甲\n- 乙\n- 新\n- 丙")).toBe("* 甲\r\n* 乙\r\n- 新\r\n* 丙\r\n");
    });

    it("删掉最后一段或最后一项：不多留换行；删光为空", () => {
        expect(mergeSource("a\nb\nc\n", "a\nb\nc", "a\nb")).toBe("a\nb\n");
        expect(mergeSource("甲\r\n\r\n乙\r\n", "甲\n\n乙", "甲")).toBe("甲\r\n");
        expect(mergeSource("* 甲\n* 乙\n", "- 甲\n- 乙", "- 甲")).toBe("* 甲\n");
        expect(mergeSource("甲\n", "甲", "")).toBe("");
    });

    it("两边都改的区域取编辑后的写法；末尾换行的有无跟着编辑结果", () => {
        expect(mergeSource("* 甲\n", "- 甲\n", "- 甲甲\n")).toBe("- 甲甲\n");
        expect(mergeSource("a\nb", "a\nb", "a\nb\n")).toBe("a\nb\n");
        expect(mergeSource("a\nb\n", "a\nb\n", "a\nb")).toBe("a\nb");
        expect(mergeSource("", "", "新")).toBe("新");
    });

});
