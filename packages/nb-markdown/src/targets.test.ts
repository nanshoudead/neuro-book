/**
 * 缺省的目标分类（docs/specs/workspace/markdown-dialect.md 输出 27；宿主不给自己的分类时用它）：只认外部链接，别的都是“其它”。
 */

import {describe, expect, it} from "bun:test";

import {classifyScheme, schemeTargets} from "./targets";

describe("缺省的目标分类", () => {
    it("http、https、mailto 是外部链接，方案不分大小写", () => {
        expect(["https://example.com/a?b#c", "HTTP://x", "mailto:a@b.c"].map((target) => classifyScheme(target).kind)).toEqual(["external", "external", "external"]);
    });

    it("别的方案与相对地址都是其它：nb-story 的出处 paragraph://41.20 显示成引用小块", () => {
        expect(classifyScheme("paragraph://41.20")).toEqual({kind: "other", name: ""});
        expect(classifyScheme("设定/%E6%9E%97%E9%9B%AA.md?x#y")).toEqual({kind: "other", name: "林雪.md"});
    });

    it("不认文件方案，插入引用时地址原样写", () => {
        expect(schemeTargets.encodeFile("设定/a#b.md")).toBe("设定/a#b.md");
    });
});
