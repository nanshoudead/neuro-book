import {describe, expect, it} from "bun:test";
import type {AgentLocale, ViewText} from "./types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";
import {formatText, textOf} from "./messages";
import {describeChain, describeTurn} from "./process-summary";

const chain = (overrides: Partial<ChainSummary>): ChainSummary => ({
    steps: 0, filesRead: 0, filesChanged: 0, others: 0, failed: 0, thinking: false, messages: 1, ...overrides,
});

const texts = (parts: ViewText[], locale: AgentLocale): string[] => parts.map((part) => textOf(part, locale));

describe("describeChain", () => {
    it("读和改写成同一句，其余操作另起一段；两种语言各代入自己的数字", () => {
        const result = describeChain(chain({thinking: true, steps: 4, filesRead: 2, filesChanged: 1, others: 1}));
        expect(texts(result.parts, "zh-CN")).toEqual(["思考", "读了 2 个文件，改了 1 个", "另有 1 次操作"]);
        expect(texts(result.parts, "en-US")).toEqual(["Thinking", "Read 2 files, changed 1", "1 other actions"]);
        expect(result.alert).toBeNull();
    });

    it("只读或只改时各写一句", () => {
        expect(texts(describeChain(chain({steps: 3, filesRead: 3})).parts, "zh-CN")).toEqual(["读了 3 个文件"]);
        expect(texts(describeChain(chain({steps: 1, filesChanged: 1})).parts, "en-US")).toEqual(["Changed 1 files"]);
    });

    it("没有读改文件时，其余操作直接写次数", () => {
        expect(texts(describeChain(chain({steps: 2, others: 2})).parts, "zh-CN")).toEqual(["2 次操作"]);
    });

    it("什么都没有时退回“过程”，失败次数单独作为提醒", () => {
        const result = describeChain(chain({steps: 1, failed: 1}));
        expect(texts(result.parts, "zh-CN")).toEqual(["过程"]);
        expect(result.alert === null ? null : textOf(result.alert, "en-US")).toBe("1 failed");
    });
});

describe("describeTurn", () => {
    it("以“过程”开头，写总操作次数与读改文件数", () => {
        const metrics = {steps: 14, filesRead: 7, filesChanged: 2, failed: 0} as TurnMetrics;
        expect(texts(describeTurn(metrics).parts, "zh-CN")).toEqual(["过程", "14 次操作", "读了 7 个文件，改了 2 个"]);
    });
});

describe("宿主给的文字", () => {
    it("中英两份按语言取，带参数的用 formatText 在两种语言里各代入一次", () => {
        const phrase = formatText({"zh-CN": "查了 {count} 处", "en-US": "{count} lookups"}, {count: 3});
        expect(textOf(phrase, "zh-CN")).toBe("查了 3 处");
        expect(textOf(phrase, "en-US")).toBe("3 lookups");
        expect(textOf("正文/第三章.md", "en-US")).toBe("正文/第三章.md");
    });
});
