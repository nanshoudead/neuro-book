/**
 * 依据一行放得下几个出处（决定 15）。
 */

import {describe, expect, test} from "bun:test";

import {visibleRefCount} from "./ref-line";

describe("依据一行", () => {
    test("全放得下就全放，不留“等 N 处”的位置", () => {
        expect(visibleRefCount({widths: [40, 40, 40], available: 120, moreWidth: 50})).toBe(3);
    });

    test("放不下时给“等 N 处”留位置；至少一个", () => {
        expect(visibleRefCount({widths: [40, 40, 40, 40], available: 130, moreWidth: 50})).toBe(2);
        expect(visibleRefCount({widths: [200, 40], available: 100, moreWidth: 50})).toBe(1);
    });
});
