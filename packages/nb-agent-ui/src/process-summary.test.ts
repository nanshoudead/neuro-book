import {describe, expect, it} from "bun:test";
import type {AgentLocale, ViewText} from "./types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";
import {formatText, textOf} from "./messages";
import {describeChain, describeTurn} from "./process-summary";

const chain = (overrides: Partial<ChainSummary>): ChainSummary => ({
    steps: 0, filesRead: 0, filesChanged: 0, others: 0, failed: 0, thinking: false, messages: 1, ...overrides,
});

/** 摘要由哪几句组成：文字表的键（去掉 `process.` 前缀）与参数。措辞属于文字表，不在这里锁。 */
function parts(texts: ViewText[]): Array<[string, Record<string, string | number> | undefined]> {
    return texts.map((text) => (typeof text === "object" && "key" in text ? [text.key.replace("process.", ""), text.params] : [String(text), undefined]));
}

describe("describeChain", () => {
    it("读和改写成同一句，其余操作另起一段", () => {
        const result = describeChain(chain({thinking: true, steps: 4, filesRead: 2, filesChanged: 1, others: 1}));
        expect(parts(result.parts)).toEqual([["thinking", undefined], ["files.readChanged", {read: 2, changed: 1}], ["others", {count: 1}]]);
        expect(result.alert).toBeNull();
    });

    it("只读或只改时各写一句", () => {
        expect(parts(describeChain(chain({steps: 3, filesRead: 3})).parts)).toEqual([["files.read", {count: 3}]]);
        expect(parts(describeChain(chain({steps: 1, filesChanged: 1})).parts)).toEqual([["files.changed", {count: 1}]]);
    });

    it("没有读改文件时，其余操作直接写次数", () => {
        expect(parts(describeChain(chain({steps: 2, others: 2})).parts)).toEqual([["actions", {count: 2}]]);
    });

    it("什么都没有时退回“过程”，失败次数单独作为提醒", () => {
        const result = describeChain(chain({steps: 1, failed: 1}));
        expect(parts(result.parts)).toEqual([["fallback", undefined]]);
        expect(result.alert).toEqual({key: "process.failed", params: {count: 1}});
    });
});

describe("describeTurn", () => {
    it("以“过程”开头，写总操作次数与读改文件数", () => {
        const metrics = {steps: 14, filesRead: 7, filesChanged: 2, failed: 0} as TurnMetrics;
        expect(parts(describeTurn(metrics).parts)).toEqual([["fallback", undefined], ["actions", {count: 14}], ["files.readChanged", {read: 7, changed: 2}]]);
    });
});

describe("界面文字", () => {
    const locales: AgentLocale[] = ["zh-CN", "en-US"];

    it("文字表的键在两种语言里都代入参数，不留占位", () => {
        for (const locale of locales) {
            const text = textOf({key: "process.files.readChanged", params: {read: 37, changed: 41}}, locale);
            expect(text).toContain("37");
            expect(text).toContain("41");
            expect(text).not.toContain("{");
        }
        expect(textOf({key: "process.actions", params: {count: 2}}, "zh-CN")).not.toBe(textOf({key: "process.actions", params: {count: 2}}, "en-US"));
    });

    it("宿主给的中英两份按语言取，带参数的用 formatText 在两种语言里各代入一次；普通字符串原样", () => {
        const phrase = formatText({"zh-CN": "甲 {n} 乙", "en-US": "A {n} B"}, {n: 3});
        expect(textOf(phrase, "zh-CN")).toBe("甲 3 乙");
        expect(textOf(phrase, "en-US")).toBe("A 3 B");
        expect(textOf("正文/第三章.md", "en-US")).toBe("正文/第三章.md");
    });
});
