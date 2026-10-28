import {describe, expect, it} from "bun:test";

import {isTextRef, resolveLocaleMap} from "@notnotype/nb-ui/text";
import type {Text} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import type {ChainSummary, TurnMetrics} from "./conversation-turns";
import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "./locales";
import {describeChain, describeTurn, describeUsage} from "./process-summary";
import {agentRef, formatText} from "./text";

/** 视图里翻译文字的是端口；这里用本包目录与 nb-ui 的最小实现，结果与宿主引擎相同（docs/specs/ui/i18n.md 输出 9）。 */
const translator = createMinimalTranslator({catalogs: {[NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS}, strict: true});
const translate = (text: Text, locale: string) => translator.translate(text, locale);

const chain = (overrides: Partial<ChainSummary>): ChainSummary => ({
    steps: 0, filesRead: 0, filesChanged: 0, others: 0, failed: 0, thinking: false, messages: 1, ...overrides,
});

/** 摘要由哪几句组成：目录的键（去掉 `process.` 前缀）与参数。措辞属于目录，不在这里锁。 */
function parts(texts: Text[]): Array<[string, Readonly<Record<string, string | number>> | undefined]> {
    return texts.map((text) => (isTextRef(text) ? [text.key.replace("process.", ""), text.params] : [String(text), undefined]));
}

describe("describeChain", () => {
    it("读和改写成同一句，其余操作另起一段", () => {
        const result = describeChain(chain({thinking: true, steps: 4, filesRead: 2, filesChanged: 1, others: 1}));
        expect(parts(result.parts)).toEqual([["thinking", undefined], ["files.readChanged", {read: 2, changed: 1, count: 2}], ["others", {count: 1}]]);
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
        expect(result.alert).toEqual(agentRef("process.failed", {count: 1}));
    });
});

describe("describeTurn", () => {
    it("以“过程”开头，写总操作次数、模型请求次数与读改文件数", () => {
        const metrics = {steps: 14, requests: 6, filesRead: 7, filesChanged: 2, failed: 0} as TurnMetrics;
        expect(parts(describeTurn(metrics).parts)).toEqual([["fallback", undefined], ["actions", {count: 14}], ["requests", {count: 6}], ["files.readChanged", {read: 7, changed: 2, count: 7}]]);
    });
});

describe("describeUsage", () => {
    const metrics = (overrides: Partial<TurnMetrics>): TurnMetrics => ({
        durationMs: null, steps: 0, requests: 0, failed: 0, filesRead: 0, filesChanged: 0, tokens: null, cost: null, usage: null, ...overrides,
    });
    const shown = (description: ReturnType<typeof describeUsage>) => description.parts.map((part) => [part.icon, translate(part.text, "zh-CN")]);

    it("用时写成分:秒，千以上的 token 写成 k；缓存读取为 0 时省略", () => {
        const result = describeUsage(metrics({durationMs: 83_400, tokens: 12_345, usage: {input: 12_000, output: 345, cacheRead: 0, cacheWrite: 0}}), "USD", {showDuration: true});
        expect(shown(result)).toEqual([
            ["i-lucide-timer", "1:23"],
            ["i-lucide-zap", "12.3k tokens"],
            ["i-lucide-arrow-down", "12.0k"],
            ["i-lucide-arrow-up", "345"],
        ]);
        expect(translate(result.detail!, "zh-CN")).toContain("缓存读取 0");
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
    it("读改合成一句时，英文按读了几个文件选单复数", () => {
        const readChanged = (read: number) => translate(describeChain(chain({steps: read + 3, filesRead: read, filesChanged: 3})).parts[0]!, "en-US");
        expect(readChanged(1)).toBe("Read 1 file, changed 3");
        expect(readChanged(2)).toBe("Read 2 files, changed 3");
    });

    it("宿主给的中英两份按语言取，带参数的用 formatText 在两种语言里各代入一次；普通字符串原样", () => {
        const phrase = formatText({"zh-CN": "甲 {n} 乙", "en-US": "A {n} B"}, {n: 3});
        expect(resolveLocaleMap(phrase, "zh-CN")).toBe("甲 3 乙");
        expect(translate(phrase, "en-US")).toBe("A 3 B");
        expect(translate("正文/第三章.md", "en-US")).toBe("正文/第三章.md");
    });
});
