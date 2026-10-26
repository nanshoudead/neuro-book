/**
 * 会话日志读不成（丢了、摘要对不上）时，只按记录显示这个对话（docs/specs/story/viewer.md 的问答页）：记录里每轮有问题
 * 与结果，没有过程。每轮造一条提问，再按结果造一条：交卷的是一次成功的 `answer` 调用（画成答案卡片），文字回复是
 * 一条回复（挂没核实的出处），失败是一条错误，中断是一条“已停止”的回复。页面另在顶上写“过程没有保留”。
 */

import type {MessageView} from "@notnotype/nb-agent-ui";

import {questionId, UNVERIFIED_REFS} from "./turns";

/** 记录里一轮在这里用到的部分（形状同 `core/qa-records` 的 `QaTurn`；网页不引核心库，那边带着 node）。 */
export interface RecordTurn {
    readonly question: string;
    readonly status: "answered" | "failed" | "interrupted";
    readonly answer: object | null;
    readonly reply: {readonly text: string; readonly unverifiedRefs: readonly string[]} | null;
    readonly error: {readonly message: string} | null;
    readonly startedAt: string;
}

export function messagesFromRecord(conversationId: string, turns: readonly RecordTurn[]): MessageView[] {
    return turns.flatMap((turn, index): MessageView[] => {
        const number = index + 1;
        const timestamp = Date.parse(turn.startedAt) || 0;
        const id = `r:${conversationId}:${number}`;
        const question: MessageView = {kind: "user", id: questionId(conversationId, number), timestamp, intent: "normal", blocks: [{kind: "text", text: turn.question}], contentOmitted: false};
        const base = {kind: "assistant" as const, id, timestamp, thinking: "", model: "", toolCalls: [], contentOmitted: false};
        if (turn.status === "failed") return [question, {kind: "error", id, timestamp, message: turn.error?.message ?? "这一轮失败了", retryable: false}];
        if (turn.status === "interrupted") return [question, {...base, status: "stopped", text: ""}];
        if (turn.answer !== null) {
            return [question, {...base, status: "done", text: "", toolCalls: [{id: `${id}:answer`, name: "answer", status: "success", args: turn.answer as never, result: {text: "", truncated: false}}]}];
        }
        const refs = turn.reply?.unverifiedRefs ?? [];
        return [question, {...base, status: "done", text: turn.reply?.text ?? "", ...(refs.length === 0 ? {} : {annotations: [{customType: UNVERIFIED_REFS, text: `没核实的出处：${refs.join("、")}`, details: {refs: [...refs]}}]})}];
    });
}
