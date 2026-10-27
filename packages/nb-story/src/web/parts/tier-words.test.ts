/**
 * 依据的人话（viewer 输出 57）：每种情况一句结论，证据两行。
 */

import {describe, expect, test} from "bun:test";

import type {StoryResult} from "../../contract/contract";
import {citedWords, echoWords, tierVerdict} from "./tier-words";

const none = {confirms: 0, contradicts: 0, revises: 0, knowers: 0, secrets: 0, answers: 0};
const statement = (fields: Partial<StoryResult<"tier.explain">>): StoryResult<"tier.explain"> => ({
    id: "s1-1", kind: "statement", tier: 2, prior: 2, flag: null, ev: "some", window: 10, signals: {refs: none, echo: {count: 1, phrases: ["x"]}}, ...fields,
});

const AT_20 = {atEnd: false, label: "第 20 章"};
const AT_END = {atEnd: true, label: "全部读完"};

describe("依据的人话", () => {
    test("待证实、伏笔候选、刚读到、旧书、升级、相符各一句", () => {
        expect(tierVerdict(statement({tier: 2, prior: 1, flag: "unconfirmed", ev: "none"}), "event", AT_20)).toBe("抽取时模型认为这是主线，但读到第 20 章，后文还没有再提起它，先算作 2 级。");
        expect(tierVerdict(statement({tier: 2, prior: 3, flag: "foreshadow", ev: "strong"}), "attitude", AT_20)).toBe("抽取时模型认为这是琐碎细节，但后文又提起了它，可能是伏笔，升为 2 级。");
        expect(tierVerdict(statement({ev: "unknown", window: 0}), "event", AT_20)).toBe("这条就在正读的这一章，还看不出后文会不会再提，暂按抽取时的判断。");
        expect(tierVerdict(statement({ev: "unknown", window: 3, prior: null}), "event", AT_20)).toBe("这条刚读到不久（之后只读了 3 章），还看不出后文会不会再提，按类别（事件）定为 2 级。");
        expect(tierVerdict(statement({prior: null, tier: 1}), "goal", AT_20)).toBe("这本书抽取时没有给重要程度，按类别（打算）和后文的情况定为 1 级。");
        expect(tierVerdict(statement({prior: 2, tier: 1, ev: "strong"}), "event", AT_20)).toBe("后文多次引用或提起它，从 2 级升为 1 级。");
        expect(tierVerdict(statement({}), "event", AT_20)).toBe("抽取时模型给 2 级，后文的情况与之相符。");
    });

    test("等级照 tier.explain 写，不照规则表猜", () => {
        expect(tierVerdict(statement({ev: "unknown", window: 2, prior: null, tier: 3}), "location", AT_20)).toContain("按类别（位置）定为 3 级");
        expect(tierVerdict(statement({prior: 2, tier: 3, ev: "none"}), "event", AT_20)).toBe("抽取时模型给 2 级，按后文的情况定为 3 级。");
    });

    test("读完全书：不写“读到全部读完”，最后几章不说“还看不出”", () => {
        expect(tierVerdict(statement({tier: 2, prior: 1, flag: "unconfirmed", ev: "none"}), "event", AT_END)).toBe("抽取时模型认为这是主线，但直到最后，后文都没有再提起它，先算作 2 级。");
        expect(tierVerdict(statement({ev: "unknown", window: 2}), "event", AT_END)).toBe("这条在最后几章，后面没有内容可以印证，暂按抽取时的判断。");
    });

    test("证据：引用分来源写，回响只写有没有", () => {
        expect(citedWords(statement({signals: {refs: {...none, confirms: 2, knowers: 1}, echo: {count: 0, phrases: []}}}))).toBe("后文确认了它 2 次；之后又有 1 人得知");
        const all = {confirms: 1, contradicts: 2, revises: 3, knowers: 4, secrets: 1, answers: 1};
        expect(citedWords(statement({signals: {refs: all, echo: {count: 0, phrases: []}}}))).toBe("后文确认了它 1 次；后文反驳了它 2 次；后文修正了它 3 次；之后又有 4 人得知；被收进后来的秘密；是悬念的答案");
        expect(citedWords(statement({}))).toBe("没有");
        expect(echoWords(statement({}))).toBe("有");
        expect(echoWords(statement({signals: {refs: none, echo: {count: 0, phrases: []}}}))).toBe("没有");
    });
});
