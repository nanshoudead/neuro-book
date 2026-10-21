import {describe, expect, it} from "vitest";

import {moveRoving, rovingMove} from "./roving";

describe("moveRoving", () => {
    const items = [{disabled: false}, {disabled: true}, {}, {disabled: true}, {}];
    const disabled = (item: {disabled?: boolean}): boolean => item.disabled === true;

    it("前后循环，跳过禁用项", () => {
        expect(moveRoving(items, 0, "next", disabled)).toBe(2);
        expect(moveRoving(items, 2, "next", disabled)).toBe(4);
        expect(moveRoving(items, 4, "next", disabled)).toBe(0);
        expect(moveRoving(items, 0, "prev", disabled)).toBe(4);
    });

    it("当前项不可用（没有当前项、当前项禁用）时，next 从第一项、prev 从最后一项开始", () => {
        expect(moveRoving(items, -1, "next", disabled)).toBe(0);
        expect(moveRoving(items, -1, "prev", disabled)).toBe(4);
        expect(moveRoving(items, 1, "next", disabled)).toBe(0);
    });

    it("first、last 到首末可用项", () => {
        expect(moveRoving(items, 2, "first", disabled)).toBe(0);
        expect(moveRoving(items, 2, "last", disabled)).toBe(4);
    });

    it("没有可用项时返回 -1", () => {
        expect(moveRoving([{disabled: true}, {disabled: true}], 0, "next", disabled)).toBe(-1);
        expect(moveRoving([], -1, "first")).toBe(-1);
    });

    it("不给判定函数时每一项都可用", () => {
        expect(moveRoving(["a", "b", "c"], 2, "next")).toBe(0);
    });
});

describe("rovingMove", () => {
    it("按方向认键：horizontal 只认左右，vertical 只认上下，both 都认；Home、End 都认", () => {
        const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Enter"];
        expect(keys.map((key) => rovingMove(key, "horizontal"))).toEqual(["next", "prev", null, null, "first", "last", null]);
        expect(keys.map((key) => rovingMove(key, "vertical"))).toEqual([null, null, "next", "prev", "first", "last", null]);
        expect(keys.map((key) => rovingMove(key, "both"))).toEqual(["next", "prev", "next", "prev", "first", "last", null]);
    });
});
