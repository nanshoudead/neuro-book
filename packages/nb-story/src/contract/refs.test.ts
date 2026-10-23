/**
 * 出处的认法（docs/specs/story/qa.md 输出 8、24）：引擎与网页共用，写法的边界在这里定。
 */

import {describe, expect, test} from "bun:test";

import {normalizeRef, parseRef, refsInText} from "./refs";

describe("出处", () => {
    test("文字里的出处：句末标点、全角、三种连接号；三段数字与紧挨数字的不算", () => {
        expect(refsInText("见 39.1。又见３９．２，和 39.3—40.4、39.5–39.6、39.7-39.8。版本 3.5.0 与 12.3.4 不算，a1.2 算，1.25 倍算")).toEqual(["39.1", "39.2", "39.3—40.4", "39.5–39.6", "39.7-39.8", "1.2", "1.25"]);
    });

    test("解析与标准写法：范围统一用“—”，写法不对时原样", () => {
        expect(parseRef("39.5–39.6")).toEqual({from: {chapter: 39, paragraph: 5}, to: {chapter: 39, paragraph: 6}});
        expect(["39.1", "３９．１", "39.7-39.8", " 39.3—40.4 ", "第 3 章"].map(normalizeRef)).toEqual(["39.1", "39.1", "39.7—39.8", "39.3—40.4", "第 3 章"]);
    });
});
