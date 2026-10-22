import {describe, expect, it} from "bun:test";
import type {AgentLocale, ViewText} from "./types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";
import {formatText, textOf} from "./messages";
import {describeChain, describeTurn, describeUsage} from "./process-summary";

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

describe("describeUsage", () => {
    const metrics = (overrides: Partial<TurnMetrics>): TurnMetrics => ({
        durationMs: null, steps: 0, failed: 0, filesRead: 0, filesChanged: 0, tokens: null, cost: null, usage: null, ...overrides,
    });
    const shown = (description: ReturnType<typeof describeUsage>) => description.parts.map((part) => [part.icon, textOf(part.text, "zh-CN")]);

    it("用时写成分:秒，千以上的 token 写成 k；缓存读取为 0 时省略", () => {
        const result = describeUsage(metrics({durationMs: 83_400, tokens: 12_345, usage: {input: 12_000, output: 345, cacheRead: 0, cacheWrite: 0}}), "USD", {showDuration: true});
        expect(shown(result)).toEqual([
            ["i-lucide-timer", "1:23"],
            ["i-lucide-zap", "12.3k tokens"],
            ["i-lucide-arrow-down", "12.0k"],
            ["i-lucide-arrow-up", "345"],
        ]);
        expect(textOf(result.detail!, "zh-CN")).toContain("缓存读取 0");
    });

    it("费用按币种加符号，不到一分钱多留两位；免费的 0 照样显示，单价未知（null）不显示", () => {
        const cost = (value: number | null, currency: "USD" | "CNY") => shown(describeUsage(metrics({cost: value}), currency, {showDuration: true})).map(([, text]) => text);
        expect(cost(0.1234, "USD")).toEqual(["$0.12"]);
        expect(cost(0.0042, "CNY")).toEqual(["¥0.0042"]);
        expect(cost(0, "USD")).toEqual(["$0"]);
        expect(cost(null, "USD")).toEqual([]);
    });

    it("不要用时、或开头不完整不知道用时时不写；没有用量数据时没有悬停说明", () => {
        expect(describeUsage(metrics({durationMs: 5000}), "USD", {showDuration: false}).parts).toEqual([]);
        expect(describeUsage(metrics({durationMs: null}), "USD", {showDuration: true}).parts).toEqual([]);
        expect(describeUsage(metrics({}), "USD", {showDuration: true}).detail).toBeNull();
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

    it("英文带数量的文字按单复数换写法，中文不变（除数字外一致）", () => {
        const shape = (key: "process.files.read" | "toolGroup.search", count: number, locale: AgentLocale) => textOf({key, params: {count}}, locale).replace(String(count), "N");
        for (const key of ["process.files.read", "toolGroup.search"] as const) {
            expect(shape(key, 1, "en-US")).not.toBe(shape(key, 2, "en-US"));
            expect(shape(key, 1, "zh-CN")).toBe(shape(key, 2, "zh-CN"));
        }
        // 读改合成一句时按“读了几个”选。
        const readChanged = (read: number) => textOf({key: "process.files.readChanged", params: {read, changed: 3}}, "en-US").replace(String(read), "N");
        expect(readChanged(1)).not.toBe(readChanged(2));
    });

    it("宿主给的中英两份按语言取，带参数的用 formatText 在两种语言里各代入一次；普通字符串原样", () => {
        const phrase = formatText({"zh-CN": "甲 {n} 乙", "en-US": "A {n} B"}, {n: 3});
        expect(textOf(phrase, "zh-CN")).toBe("甲 3 乙");
        expect(textOf(phrase, "en-US")).toBe("A 3 B");
        expect(textOf("正文/第三章.md", "en-US")).toBe("正文/第三章.md");
    });
});
