/**
 * 关系图控件偏好（docs/specs/story/viewer.md 输出 22）：读出来逐项校验，坏值回缺省。
 */

import {beforeEach, describe, expect, test} from "bun:test";

import {DEFAULT_RELATIONS_VIEW, readRelationsView, strongestEdges, writeRelationsView} from "./relations-view";

const store = new Map<string, string>();
beforeEach(() => {
    store.clear();
    (globalThis as unknown as {window: unknown}).window = {localStorage: {getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value)}};
});

describe("关系图控件偏好（输出 22）", () => {
    test("没存过是缺省；存了就原样读回", () => {
        expect(readRelationsView()).toEqual(DEFAULT_RELATIONS_VIEW);
        const view = {kindIds: ["person", "item"], layers: ["co"], minTogether: 5, layout: "circle" as const, neighborhood: true, showAnonymous: true, strongOnly: true};
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

describe("只画最强的线", () => {
    const edge = (a: string, b: string, statements: number, extra: {together?: number; ab?: number; ba?: number; identity?: string | null} = {}) => ({a, b, statements, together: extra.together ?? 0, ab: extra.ab ?? 0, ba: extra.ba ?? 0, identity: extra.identity ?? null});
    const RELATION = {layers: ["relation", "co"], minCo: 2, knowsAllowed: true};

    test("一条线只要是某一端最强的三条之一就留；两端都已有三条更强的线时去掉；叶子点的唯一一条线总是留，没有点变成孤点", () => {
        // 两个中心 a、b 各连着三个叶子（强度 5），a 与 b 之间只有一条弱线（强度 1）：两端都已有三条更强的线，被去掉。
        const strong = [edge("a", "a1", 5), edge("a", "a2", 5), edge("a", "a3", 5), edge("b", "b1", 5), edge("b", "b2", 5), edge("b", "b3", 5)];
        expect(strongestEdges([...strong, edge("a", "b", 1)], RELATION)).toEqual(strong);
        // 叶子 c 只有一条线，即使很弱也留：它是 c 最强的一条。
        expect(strongestEdges([...strong, edge("a", "c", 1)], RELATION).map(item => item.b)).toContain("c");
    });

    test("先应用连线层与同场门槛再排名：被隐藏的层里的强线不会挤掉真正画出来的线；身份线原样保留、不参与排名", () => {
        // 中心 a 有三条只靠“认知”的强线（认知层没开）、一条画得出来的弱关系线 a-x：关系线是 a 唯一画出来的线，必须留下；
        // 同场次数低于门槛 2 的线算不上画出来。
        const hiddenStrong = [edge("a", "k1", 0, {ab: 9}), edge("a", "k2", 0, {ab: 9}), edge("a", "k3", 0, {ab: 9})];
        const kept = strongestEdges([...hiddenStrong, edge("a", "x", 1), edge("a", "y", 0, {together: 1}), edge("a", "z", 0, {identity: "uncertain"})], RELATION);
        expect(kept.map(item => item.b)).toEqual(["x", "z"]);
    });
});
