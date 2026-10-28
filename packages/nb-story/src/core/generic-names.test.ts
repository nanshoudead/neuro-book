/**
 * 泛称（docs/specs/story/queries.md 输出 22）：整个词是泛称，或能完全切成几个泛称。
 */

import {describe, expect, test} from "bun:test";

import {allGeneric, isGenericName} from "./generic-names";

describe("泛称（输出 22）", () => {
    test("整个词是泛称才算：带专名的称呼不算", () => {
        expect(isGenericName("学姐")).toBe(true);
        expect(isGenericName(" 新生 ")).toBe(true);
        expect(isGenericName("那个学生")).toBe(true);
        expect(isGenericName("一位老师")).toBe(true);
        expect(isGenericName("那个星瑕")).toBe(false);
        expect(isGenericName("墨学姐")).toBe(false);
        expect(isGenericName("绯烟老师")).toBe(false);
        expect(isGenericName("星瑕")).toBe(false);
    });

    test("几个泛称连写也是泛称；夹着专名的不是", () => {
        expect(isGenericName("志愿者学姐")).toBe(true);
        expect(isGenericName("那位志愿者学姐")).toBe(true);
        expect(isGenericName("学生会长")).toBe(true);
        expect(isGenericName("墨学姐")).toBe(false);
        expect(isGenericName("学姐墨砚秋")).toBe(false);
        expect(allGeneric([{text: "志愿者学姐"}, {text: "学姐"}])).toBe(true);
    });

    test("称呼全是泛称或没有称呼：无名；有一个专名就不是", () => {
        expect(allGeneric([])).toBe(true);
        expect(allGeneric([{text: "学姐"}, {text: "新生"}])).toBe(true);
        expect(allGeneric([{text: "学姐"}, {text: "墨砚秋"}])).toBe(false);
    });
});
