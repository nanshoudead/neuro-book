/**
 * 按记录的各轮补分轮要的东西：每轮的提问 id 固定、开头没有提问的轮用记录里的问题补、运行中先放乐观的提问、
 * 没核实的出处挂在这一轮最后的回复上，换过的对象按原对象缓存。
 */

import {describe, expect, test} from "bun:test";

import type {AssistantMessageView, MessageView} from "@notnotype/nb-agent-ui";

import {composeMessages, createMessageCache, questionId, UNVERIFIED_REFS} from "./turns";

const user = (seq: number, text: string): MessageView => ({kind: "user", id: `h${seq}`, timestamp: seq, intent: "normal", blocks: [{kind: "text", text}], contentOmitted: false});
const reply = (seq: number, text: string): AssistantMessageView => ({kind: "assistant", id: `h${seq}`, timestamp: seq, status: "done", text, thinking: "", model: "m", toolCalls: [], contentOmitted: false});
const failure = (seq: number): MessageView => ({kind: "error", id: `h${seq}`, timestamp: seq, message: "没有密钥", retryable: false});
const turn = (question: string, logFrom: number, unverifiedRefs: string[] = []) => ({question, logFrom, unverifiedRefs, startedAt: "2026-10-23T00:00:00.000Z"});

describe("按记录分轮", () => {
    test("首轮在写提问前就失败：补一条提问，错误留在这一轮，不挂到别的轮；每轮提问的 id 固定", () => {
        // 日志：1 快照，2 运行结束（缺密钥）；3 第二问，4 回复，5 用量。
        const messages = [failure(2), user(3, "第二问"), reply(4, "答")];
        const composed = composeMessages(messages, {conversationId: "c", turns: [turn("第一问", 1), turn("第二问", 3)], running: null}, createMessageCache());
        expect(composed.map(message => [message.kind, message.id])).toEqual([["user", questionId("c", 1)], ["error", "h2"], ["user", questionId("c", 2)], ["assistant", "h4"]]);
        expect((composed[0] as {blocks: {text: string}[]}).blocks[0]!.text).toBe("第一问");
        expect((composed[0] as {delivery?: string}).delivery).toBeUndefined();
    });

    test("运行中提问还没进日志：先放乐观的提问（pending），id 与之后日志里真的那条相同", () => {
        const cache = createMessageCache();
        const before = composeMessages([user(3, "第一问"), reply(4, "答")], {conversationId: "c", turns: [turn("第一问", 1)], running: turn("追问", 6)}, cache);
        expect(before.at(-1)).toMatchObject({id: questionId("c", 2), delivery: "pending"});
        const after = composeMessages([user(3, "第一问"), reply(4, "答"), user(6, "追问")], {conversationId: "c", turns: [turn("第一问", 1)], running: turn("追问", 6)}, cache);
        expect(after.at(-1)).toMatchObject({id: questionId("c", 2), blocks: [{kind: "text", text: "追问"}]});
        expect((after.at(-1) as {delivery?: string}).delivery).toBeUndefined();
    });

    test("没核实的出处挂在这一轮最后有文字的回复上；换过的对象按原对象缓存，节拍时引用不变", () => {
        const cache = createMessageCache();
        const messages = [user(3, "问"), reply(4, "先说"), reply(5, "结论见 39.1")];
        const input = {conversationId: "c", turns: [turn("问", 1, ["39.1"])], running: null};
        const first = composeMessages(messages, input, cache);
        expect((first[2] as AssistantMessageView).annotations).toEqual([{customType: UNVERIFIED_REFS, text: "没核实的出处：39.1", details: {refs: ["39.1"]}}]);
        expect((first[1] as AssistantMessageView).annotations).toBeUndefined();
        const again = composeMessages(messages, input, cache);
        expect(again.every((message, index) => message === first[index])).toBe(true);
    });

    test("旧记录没有 logFrom：原样交出", () => {
        const messages = [user(3, "问"), reply(4, "答")];
        expect(composeMessages(messages, {conversationId: "c", turns: [{question: "问", startedAt: "2026-10-23T00:00:00.000Z"}], running: null}, createMessageCache())).toEqual(messages);
    });
});
