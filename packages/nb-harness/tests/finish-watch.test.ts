/**
 * 结束原因探针（#258）：直接喂不同网关的 SSE 块形状，断言“有没有给出结束原因”。真实 provider 里的效果在 provider.test.ts。
 */

import {describe, expect, test} from "bun:test";

import {createFinishWatch} from "../src/finish-watch";

const feed = (...chunks: (object | string)[]): boolean => {
    const watch = createFinishWatch();
    for (const chunk of chunks) watch.observe({data: typeof chunk === "string" ? chunk : JSON.stringify(chunk)});
    return watch.missing;
};
const text = {choices: [{index: 0, delta: {content: "半句"}, finish_reason: null}]};

describe("结束原因探针", () => {
    test("choices 里给了结束原因：不缺；一直没给（只有 [DONE]）：缺", () => {
        expect(feed(text, {choices: [{index: 0, delta: {}, finish_reason: "stop"}]}, "[DONE]")).toBe(false);
        expect(feed(text, "[DONE]")).toBe(true);
    });

    test("带 usage 的末块把结束原因放在顶层：不缺；字面量 \"null\" 与空串不算结束原因", () => {
        expect(feed(text, {choices: [], usage: {completion_tokens: 3}, finish_reason: "stop"}, "[DONE]")).toBe(false);
        expect(feed({choices: [{index: 0, delta: {content: "半句"}, finish_reason: "null"}]}, "[DONE]")).toBe(true);
        expect(feed({choices: [{index: 0, delta: {content: "半句"}, finish_reason: ""}]}, "[DONE]")).toBe(true);
    });

    test("没有 choices 的流（Responses、Anthropic 的事件）、心跳与注释：永远不缺", () => {
        expect(feed({type: "response.created"}, {type: "response.completed", response: {status: "completed"}})).toBe(false);
        expect(feed("", ": keep-alive", "not json", "[DONE]")).toBe(false);
    });
});
