/**
 * 依据一行放得下几个出处（决定 15）。
 */

import {describe, expect, test} from "bun:test";

import {refSegments, visibleRefCount} from "./ref-line";

describe("依据一行", () => {
    test("指向打不开的章的出处当纯文字（ref 为 null）", () => {
        expect(refSegments("见20.3与22.1。", chapter => chapter <= 20)).toEqual([
            {text: "见", ref: null},
            {text: "20.3", ref: "20.3"},
            {text: "与", ref: null},
            {text: "22.1", ref: null},
            {text: "。", ref: null},
        ]);
    });

    test("全放得下就全放，不留“等 N 处”的位置", () => {
        expect(visibleRefCount({widths: [40, 40, 40], available: 120, moreWidth: 50})).toBe(3);
    });

    test("放不下时给“等 N 处”留位置；至少一个", () => {
        expect(visibleRefCount({widths: [40, 40, 40, 40], available: 130, moreWidth: 50})).toBe(2);
        expect(visibleRefCount({widths: [200, 40], available: 100, moreWidth: 50})).toBe(1);
    });
});

describe("文字里的出处", () => {
    test("切成纯文字与出处，出处给标准写法，原文不动", () => {
        expect(refSegments("见３７．８与38.50-38.57。")).toEqual([
            {text: "见", ref: null},
            {text: "３７．８", ref: "37.8"},
            {text: "与", ref: null},
            {text: "38.50-38.57", ref: "38.50—38.57"},
            {text: "。", ref: null},
        ]);
        expect(refSegments("没有出处")).toEqual([{text: "没有出处", ref: null}]);
    });
});
