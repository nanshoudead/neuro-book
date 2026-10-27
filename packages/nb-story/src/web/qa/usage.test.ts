/**
 * 会话用量（docs/specs/story/viewer.md 输出 52）：累积、命中率、费用与缓存条的算法。
 */

import {describe, expect, test} from "bun:test";
import type {MessageView} from "@notnotype/nb-agent-ui";

import {cacheBar, contextPercent, formatCost, formatPercent, requestsOf, sessionUsage} from "./usage";

const assistant = (usage: {input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null} | undefined, id = "a"): MessageView => ({kind: "assistant", id, status: "done", text: "", toolCalls: [], ...(usage === undefined ? {} : {usage})}) as unknown as MessageView;
const user = {kind: "user", id: "u", text: "问"} as unknown as MessageView;

describe("会话用量（输出 52）", () => {
    test("一条带用量的助手消息是一次请求；用户消息与没有用量的助手消息不算；提示词是输入加缓存读写", () => {
        const messages = [user, assistant({input: 100, output: 20, cacheRead: 300, cacheWrite: 100, cost: 0.5}), assistant(undefined, "b"), user, assistant({input: 50, output: 10, cacheRead: 450, cacheWrite: 0, cost: 0.25}, "c")];
        const requests = requestsOf(messages);
        expect(requests.map(request => [request.index, request.prompt, request.hitRate])).toEqual([[1, 500, 0.6], [2, 500, 0.9]]);
    });

    test("累积：各项相加；命中率是缓存读占全部提示词；费用只加已知的，一个都不知道时为 null", () => {
        const total = sessionUsage([assistant({input: 100, output: 20, cacheRead: 300, cacheWrite: 100, cost: 0.5}), assistant({input: 50, output: 10, cacheRead: 450, cacheWrite: 0, cost: null}, "c")]);
        expect(total).toMatchObject({input: 150, output: 30, cacheRead: 750, cacheWrite: 100, cost: 0.5});
        expect(total.hitRate).toBeCloseTo(750 / 1000);
        expect(sessionUsage([assistant({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: null})]).cost).toBeNull();
        expect(sessionUsage([])).toMatchObject({requests: [], input: 0, hitRate: null, cost: null});
    });

    test("缓存条三段合计 100；提示词为 0 时全 0；上下文百分比在窗口未知时为 null", () => {
        const [first] = requestsOf([assistant({input: 100, output: 0, cacheRead: 300, cacheWrite: 100, cost: null})]);
        const bar = cacheBar(first!);
        expect(bar.read).toBeCloseTo(60);
        expect(bar.write).toBeCloseTo(20);
        expect(bar.read + bar.write + bar.fresh).toBeCloseTo(100);
        const [empty] = requestsOf([assistant({input: 0, output: 5, cacheRead: 0, cacheWrite: 0, cost: null})]);
        expect(cacheBar(empty!)).toEqual({read: 0, write: 0, fresh: 0});
        expect(contextPercent(38_200, 1_000_000)).toBeCloseTo(3.82);
        expect(contextPercent(10, null)).toBeNull();
        expect(contextPercent(10, 0)).toBeNull();
    });

    test("金额与百分比的短写", () => {
        expect(formatCost(0.314, "CNY")).toBe("¥0.31");
        expect(formatCost(0.004, "USD")).toBe("$< 0.01");
        expect(formatCost(0, "CNY")).toBe("¥0.00");
        expect(formatPercent(88.4)).toBe("88%");
        expect(formatPercent(3.82)).toBe("3.8%");
    });
});
