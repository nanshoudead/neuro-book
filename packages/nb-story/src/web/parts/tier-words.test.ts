/**
 * 依据的人话（viewer 输出 57）：五种情况各一句，证据两行。
 */

import {describe, expect, test} from "bun:test";

import type {StoryResult} from "../../contract/contract";
import {citedWords, echoWords, tierVerdict} from "./tier-words";

const none = {confirms: 0, contradicts: 0, revises: 0, knowers: 0, secrets: 0, answers: 0};
const statement = (fields: Partial<StoryResult<"tier.explain">>): StoryResult<"tier.explain"> => ({
    id: "s1-1", kind: "statement", tier: 2, prior: 2, flag: null, ev: "some", window: 10, signals: {refs: none, echo: {count: 1, phrases: ["x"]}}, ...fields,
});

describe("依据的人话", () => {
    test("待证实、伏笔候选、刚读到、旧书、相符各一句", () => {
        expect(tierVerdict(statement({tier: 2, prior: 1, flag: "unconfirmed", ev: "none"}), "event", "第 20 章")).toBe("抽取时模型认为这是主线，但读到第 20 章，后文还没有再提起它，先算作 2 级。");
        expect(tierVerdict(statement({tier: 2, prior: 3, flag: "foreshadow", ev: "strong"}), "attitude", "第 20 章")).toContain("可能是伏笔");
        expect(tierVerdict(statement({ev: "unknown", window: 0}), "event", "第 20 章")).toBe("这条就在正读的这一章，还看不出后文会不会再提，暂按抽取时的判断。");
        expect(tierVerdict(statement({ev: "unknown", window: 3, prior: null}), "event", "第 20 章")).toBe("这条刚读到不久（之后只读了 3 章），还看不出后文会不会再提，先算作 2 级。");
        expect(tierVerdict(statement({prior: null, tier: 1}), "goal", "第 20 章")).toBe("这本书抽取时没有给重要程度，按类别（打算）和后文的情况定为 1 级。");
        expect(tierVerdict(statement({prior: 2, tier: 1, ev: "strong"}), "event", "第 20 章")).toBe("后文多次引用或提起它，从 2 级升为 1 级。");
        expect(tierVerdict(statement({}), "event", "第 20 章")).toBe("抽取时模型给 2 级，后文的情况与之相符。");
        expect(tierVerdict({id: "p1-1", kind: "episode", tier: 1, prior: 1, flag: null, ev: null, window: null, signals: null}, null, "第 20 章")).toContain("主线（1 级）");
    });

    test("证据：引用分来源写，回响只写有没有", () => {
        expect(citedWords(statement({signals: {refs: {...none, confirms: 2, knowers: 1}, echo: {count: 0, phrases: []}}}))).toBe("后文确认了它 2 次；之后又有 1 人得知");
        expect(citedWords(statement({}))).toBe("没有");
        expect(echoWords(statement({}))).toBe("有");
        expect(echoWords(statement({signals: {refs: none, echo: {count: 0, phrases: []}}}))).toBe("没有");
    });
});
