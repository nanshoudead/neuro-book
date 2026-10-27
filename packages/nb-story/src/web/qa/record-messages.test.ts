/**
 * 日志读不成时只按记录显示：每轮一条提问，再按结果一条（答案卡片、文字回复加附注、错误、已停止）。
 */

import {describe, expect, test} from "bun:test";

import {messagesFromRecord} from "./record-messages";
import {questionId, UNVERIFIED_REFS} from "./turns";

const startedAt = "2026-10-23T00:00:00.000Z";
const answer = {conclusion: "结论", conclusionType: "推断", explanation: "e", evidence: ["38.55"], coverage: "c"};

describe("只按记录显示", () => {
    test("四种结果各造一条，提问 id 与有日志时相同", () => {
        const messages = messagesFromRecord("c", [
            {question: "一", status: "answered", answer: answer as never, reply: null, error: null, startedAt},
            {question: "二", status: "answered", answer: null, reply: {text: "见 39.1", unverifiedRefs: ["39.1"]}, error: null, startedAt},
            {question: "三", status: "failed", answer: null, reply: null, error: {message: "连不上"}, startedAt},
            {question: "四", status: "interrupted", answer: null, reply: null, error: null, startedAt},
        ]);
        expect(messages.filter(message => message.kind === "user").map(message => message.id)).toEqual([1, 2, 3, 4].map(turn => questionId("c", turn)));
        expect(messages[1]).toMatchObject({kind: "assistant", toolCalls: [{name: "answer", status: "success", args: answer}]});
        expect(messages[3]).toMatchObject({kind: "assistant", text: "见 39.1", annotations: [{customType: UNVERIFIED_REFS, details: {refs: ["39.1"]}}]});
        expect(messages[5]).toMatchObject({kind: "error", message: "连不上"});
        expect(messages[7]).toMatchObject({kind: "assistant", status: "stopped"});
    });

    test("文字回复没有出处也没读原文：挂未查原文的提醒", () => {
        const messages = messagesFromRecord("c", [{question: "主角叫什么", status: "answered", answer: null, reply: {text: "南小风", unverifiedRefs: [], ungrounded: true}, error: null, startedAt}]);
        expect(messages[1]).toMatchObject({kind: "assistant", text: "南小风", annotations: [{customType: UNVERIFIED_REFS, text: "这一轮没有查原文", details: {refs: []}}]});
    });

});
