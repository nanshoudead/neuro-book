/**
 * 关系图控件偏好（docs/specs/story/viewer.md 输出 22）：读出来逐项校验，坏值回缺省。
 */

import {beforeEach, describe, expect, test} from "bun:test";

import {DEFAULT_RELATIONS_VIEW, readRelationsView, writeRelationsView} from "./relations-view";

const store = new Map<string, string>();
beforeEach(() => {
    store.clear();
    (globalThis as unknown as {window: unknown}).window = {localStorage: {getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value)}};
});

describe("关系图控件偏好（输出 22）", () => {
    test("没存过是缺省；存了就原样读回", () => {
        expect(readRelationsView()).toEqual(DEFAULT_RELATIONS_VIEW);
        const view = {kindIds: ["person", "item"], layers: ["co"], minTogether: 5, layout: "circle" as const, neighborhood: true, showAnonymous: true};
        writeRelationsView(view);
        expect(readRelationsView()).toEqual(view);
    });

    test("坏值逐项回缺省：不是 JSON、未知类别与层、门槛越界、排版不认识", () => {
        store.set("nbstory:relations-view", "不是 json");
        expect(readRelationsView()).toEqual(DEFAULT_RELATIONS_VIEW);
        store.set("nbstory:relations-view", JSON.stringify({kindIds: ["person", "dragon"], layers: "co", minTogether: 99, layout: "spiral", neighborhood: "yes", showAnonymous: true}));
        expect(readRelationsView()).toEqual({...DEFAULT_RELATIONS_VIEW, showAnonymous: true});
    });
});
