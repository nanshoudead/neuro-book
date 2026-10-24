/**
 * 按记录的各轮补分轮要的东西：每轮的提问 id 固定、开头没有提问的轮用记录里的问题补、运行中先放乐观的提问、
 * 没核实的出处挂在这一轮最后的回复上，换过的对象按原对象缓存。
 */

import {describe, expect, test} from "bun:test";

import type {AssistantMessageView, MessageView} from "@notnotype/nb-agent-ui";

import {composeMessages, createMessageCache, questionId, replyCheckOf, UNVERIFIED_REFS} from "./turns";

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

    test("出处复查：同一轮里第一问之后的用户消息是过程里的一行，不开新的一轮；最后的回复是复查后的", () => {
        // 日志：1 快照，2 提问，3 回复（出处没读过），4 复查的 meta（适配器不出消息），5 复查消息，6 改过的回复。
        const messages = [user(2, "地狱猫是谁"), reply(3, "她是（37.8）"), user(5, "出处检查：回答里这些出处不是这个对话里读过的段落：37.8、38.1。先用 read 读这些段落核对"), reply(6, "改过的（37.8）")];
        const replyChecks = new Map([[4, ["37.8", "38.1"]]]);
        const composed = composeMessages(messages, {conversationId: "c", turns: [turn("地狱猫是谁", 1)], running: null, replyChecks}, createMessageCache());
        expect(composed.map(message => [message.kind, message.id])).toEqual([["user", questionId("c", 1)], ["assistant", "h3"], ["system", "h5"], ["assistant", "h6"]]);
        expect(composed[2]).toMatchObject({source: "reminder", label: "出处检查", text: "37.8、38.1 没读过，已让模型重写"});
        expect(composed.filter(message => message.kind === "user")).toHaveLength(1);
        // 没收到元数据时（例如日志被截断）照样是一行，不列出处。
        expect(composeMessages(messages, {conversationId: "c", turns: [turn("地狱猫是谁", 1)], running: null}, createMessageCache())[2]).toMatchObject({kind: "system", text: "有没读过的出处，已让模型重写"});
        expect(replyCheckOf({seq: 4, kind: "meta", key: "nb-story.reply-check", value: {unverified: ["37.8"]}})).toEqual({seq: 4, refs: ["37.8"]});
        expect(replyCheckOf({seq: 4, kind: "meta", key: "other", value: {}})).toBeNull();
    });

    test("一轮开头不是提问时补一条，日志里的提问仍是提问，不当成复查", () => {
        const messages = [reply(2, "旧的错误"), user(3, "地狱猫是谁"), reply(4, "她是")];
        const composed = composeMessages(messages, {conversationId: "c", turns: [turn("地狱猫是谁", 1)], running: null}, createMessageCache());
        expect(composed.filter(message => message.kind === "system")).toEqual([]);
    });
});
