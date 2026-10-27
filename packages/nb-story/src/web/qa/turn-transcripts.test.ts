/**
 * 按轮分开的转录：开始前就停下、缺密钥的一轮只有 run_end 时，不改上一轮的回复，自己那一轮单独显示；运行中的事件只进
 * 最后一轮。真实的适配器（nb-agent-ui 的 createHarnessTranscript），按 turns.ts 合成后断言页面看到的消息。
 */

import {describe, expect, test} from "bun:test";

import type {MessageView} from "@notnotype/nb-agent-ui";

import {createTurnTranscripts} from "./turn-transcripts";
import {composeMessages, createMessageCache} from "./turns";

const AT = "2026-10-23T08:00:00.000Z";
const entry = (seq: number, kind: string, fields: Record<string, unknown> = {}) => ({seq, at: AT, kind, ...fields});
const user = (seq: number, text: string) => entry(seq, "agent_message", {message: {role: "user", content: text, timestamp: seq}});
const reply = (seq: number, text: string) => entry(seq, "agent_message", {message: {role: "assistant", content: [{type: "text", text}], model: "m", stopReason: "stop", timestamp: seq}});
const stopped = (seq: number) => entry(seq, "run_end", {stopReason: "aborted", error: null});
const noKey = (seq: number) => entry(seq, "run_end", {stopReason: "error", error: {kind: "auth", status: null, message: "Missing env"}});
const turn = (question: string, logFrom: number) => ({question, logFrom, startedAt: AT});

const shown = (messages: readonly MessageView[]) =>
    messages.map(message => (message.kind === "user" ? `问:${(message.blocks[0] as {text: string}).text}` : message.kind === "assistant" ? `答:${message.text}(${message.status})` : message.kind === "system" ? `系统:${message.label}:${message.text}` : `错:${message.kind}`));

describe("按轮分开", () => {
    test("答完一轮 → 第二轮开始前就停了 → 第三轮正常：第一轮的回复不变，第二轮单独一条已停止", () => {
        const turns = [turn("第一问", 1), turn("第二问", 4), turn("第三问", 5)];
        const transcripts = createTurnTranscripts(turns.map(item => item.logFrom));
        for (const item of [entry(1, "session_snapshot", {profile: {key: "q", version: "2"}, initial: {}, tools: []}), user(2, "第一问"), reply(3, "第一答"), stopped(4), user(5, "第三问"), reply(6, "第三答")]) transcripts.applyLogEntry(item);
        expect(shown(composeMessages(transcripts.messages(), {conversationId: "c", turns, running: null}, createMessageCache()))).toEqual(["问:第一问", "答:第一答(done)", "问:第二问", "答:(stopped)", "问:第三问", "答:第三答(done)"]);
    });

    test("缺密钥的首轮 → 续问成功：错误留在第一轮，第二轮照常", () => {
        const turns = [turn("第一问", 1), turn("第二问", 3)];
        const transcripts = createTurnTranscripts(turns.map(item => item.logFrom));
        for (const item of [entry(1, "session_snapshot", {profile: {key: "q", version: "2"}, initial: {}, tools: []}), noKey(2), user(3, "第二问"), reply(4, "第二答")]) transcripts.applyLogEntry(item);
        expect(shown(composeMessages(transcripts.messages(), {conversationId: "c", turns, running: null}, createMessageCache()))).toEqual(["问:第一问", "错:error", "问:第二问", "答:第二答(done)"]);
    });

    test("运行中的事件只进最后一轮", () => {
        const transcripts = createTurnTranscripts([1, 4]);
        for (const item of [user(2, "第一问"), reply(3, "第一答")]) transcripts.applyLogEntry(item);
        transcripts.applyEvent({type: "message_start", message: {role: "assistant", content: [{type: "text", text: "正在"}], timestamp: 9}});
        expect(shown(transcripts.messages())).toEqual(["问:第一问", "答:第一答(done)", "答:正在(streaming)"]);
    });
});

describe("对话中途改阅读位置的提醒（t25）", () => {
    const REMINDER = "<system-reminder>\n阅读位置从第 27 章改为第 40 章。你可以访问第 40 章及之前的内容了。\n</system-reminder>";
    const position = (seq: number) => entry(seq, "meta", {key: "qa.position", value: {chapter: 40, paragraph: 10, from: {chapter: 27, paragraph: 10}}});
    const head = entry(1, "session_snapshot", {profile: {key: "q", version: "2"}, initial: {}, tools: []});

    test("提醒消息后面紧跟 qa.position 元数据：显示成一条可展开的系统提醒，放在上一轮末尾，不开新的一轮、不被当成复查消息", () => {
        const turns = [turn("第一问", 1), turn("第二问", 6)];
        const transcripts = createTurnTranscripts(turns.map(item => item.logFrom));
        for (const item of [head, user(2, "第一问"), reply(3, "第一答"), user(4, REMINDER), position(5), user(6, "第二问"), reply(7, "第二答")]) transcripts.applyLogEntry(item);
        expect(shown(composeMessages(transcripts.messages(), {conversationId: "c", turns, running: null}, createMessageCache()))).toEqual([
            "问:第一问",
            "答:第一答(done)",
            "系统:系统提醒:阅读位置从第 27 章改为第 40 章。你可以访问第 40 章及之前的内容了。",
            "问:第二问",
            "答:第二答(done)",
        ]);
    });

    test("用户自己把同样的标签当问题提交：没有紧跟的元数据，就是一条普通的提问，不冒充系统提醒", () => {
        const turns = [turn(REMINDER, 1)];
        const transcripts = createTurnTranscripts(turns.map(item => item.logFrom));
        for (const item of [head, user(2, REMINDER), reply(3, "答")]) transcripts.applyLogEntry(item);
        expect(shown(composeMessages(transcripts.messages(), {conversationId: "c", turns, running: null}, createMessageCache()))).toEqual([`问:${REMINDER}`, "答:答(done)"]);
    });
});

