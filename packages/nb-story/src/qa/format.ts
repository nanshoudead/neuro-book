/**
 * 问答结果给人读的格式（docs/specs/story/qa.md 输出 12、16）：`nbstory ask` 与 `nbstory qa <id>` 共用。出处一律
 * “章.段”。
 */

import type {Answer, QaConversation, QaMode, QaReply, QaTurn, QaUsage} from "../core/qa-records";
import type {QaTurnResult} from "./engine";
import {currentPosition} from "../contract/qa-record";

function refs(list: readonly string[]): string {
    return list.length > 0 ? `〔${list.join("，")}〕` : "";
}

/**
 * 答案正文：结论、结论类型、表或分点、展开说明与覆盖说明。不含用量、记录 id 这类运行信息；回归送判时也用它，
 * 判分器只看到作答内容。
 */
export function answerText(answer: Answer): string {
    const lines = [`结论（${answer.conclusionType}）：${answer.conclusion}`];
    if (answer.knowledge && answer.knowledge.length > 0) {
        lines.push("", "| 谁 | 知道吗 | 怎么知道的 | 依据 |", "|---|---|---|---|");
        for (const row of answer.knowledge) lines.push(`| ${row.who} | ${row.state} | ${row.how} | ${row.refs.join("，")} |`);
    }
    if (answer.points && answer.points.length > 0) {
        lines.push("");
        for (const point of answer.points) lines.push(`- ${point.text} ${refs(point.refs)}`.trimEnd());
    }
    lines.push("", `说明：${answer.explanation}`, "", `依据：${answer.evidence.join("，") || "无"}`, `覆盖：${answer.coverage}`);
    return lines.join("\n");
}

const STATUS_WORDS = {answered: "已答", failed: "失败", interrupted: "中断"} as const;

function usageText(usage: QaUsage): string {
    const tokens = `输入 ${usage.input}、缓存读 ${usage.cacheRead}、缓存写 ${usage.cacheWrite}、输出 ${usage.output} token`;
    const cost = usage.cost === null ? "费用未知（没有配置单价）" : `费用 ${usage.cost.toFixed(4)}`;
    return `${tokens}；${cost}${usage.complete ? "" : "（不完整，只是下界）"}`;
}

const RECHECK_WORDS: Record<NonNullable<QaTurn["recheck"]>["outcome"], string> = {rewritten: "让模型重写了一次", failed: "重写时出错，保留第一次的回复", aborted: "重写时被取消，保留第一次的回复"};

/** 文字回复：正文，截断与没核实的出处另起一行说明（qa.md 输出 12、24）。 */
export function replyText(reply: QaReply): string {
    const lines = [reply.text];
    if (reply.truncated) lines.push("", "（输出到上限，回复被截断）");
    if (reply.unverifiedRefs.length > 0) lines.push("", `没核实的出处（没读过或晚于阅读位置）：${reply.unverifiedRefs.join("，")}`);
    if (reply.ungrounded === true) lines.push("", "（这一轮没有查原文，回答没有出处）");
    return lines.join("\n");
}

/** 一轮的正文与运行信息；`ask` 的输出与 `qa <id>` 的每一轮共用。 */
function turnBody(turn: QaTurn, mode: QaMode): string[] {
    const body = turn.answer
        ? [answerText(turn.answer)]
        : turn.reply
          ? [replyText(turn.reply)]
          : turn.error
            ? [`失败（${turn.error.code}${turn.error.kind ? `，${turn.error.kind}` : ""}）：${turn.error.message}`]
            : ["已中断，没有答案"];
    const read = mode === "full" ? "全读" : `读过的章：${turn.chaptersRead.join("、") || "无"}`;
    const recheck = turn.recheck === undefined ? [] : [`出处检查：${turn.recheck.unverified} 处没读过，${RECHECK_WORDS[turn.recheck.outcome]}`];
    return [...body, "", `${read}；作答被退回 ${turn.rejections} 次`, ...recheck, `用量：${usageText(turn.usage)}`, `用时 ${(turn.ms / 1000).toFixed(1)} 秒；模型 ${turn.model}`];
}

const at = (position: {chapter: number; paragraph: number}) => `${position.chapter}.${position.paragraph}`;

function positionText(conversation: Pick<QaTurnResult, "at" | "mode"> | QaConversation): string {
    // 对话中途改过位置：显示下一问用的位置，开始时的位置另注（t25，与引擎、网页用同一规则）。
    const now = "turns" in conversation ? currentPosition(conversation) : conversation.at;
    const start = "turns" in conversation && at(now) !== at(conversation.at) ? `（开始时 ${at(conversation.at)}）` : "";
    return `阅读位置 ${at(now)}${start}，${conversation.mode === "graph" ? "图当目录" : "全读"}`;
}

/** `ask` 的输出：这一轮的问题与回答，最后写对话 id 与追问的命令。 */
export function turnText(result: QaTurnResult): string {
    return [
        `问题：${result.question}`,
        `${positionText(result)}，${STATUS_WORDS[result.status]}`,
        "",
        ...turnBody(result, result.mode),
        `对话 ${result.id} 第 ${result.turn} 轮；追问：nbstory ask <问题> --continue ${result.id}`,
    ].join("\n");
}

/** `qa <id>`：按轮显示整个对话。 */
export function conversationText(conversation: QaConversation): string {
    const lines = [`对话 ${conversation.id}，${positionText(conversation)}，${conversation.turns.length} 轮`];
    // 每轮只在读到的位置和上一轮（第一轮和开始时）不同时标出来，没改过位置的对话不多出这一段。
    let previous = at(conversation.at);
    conversation.turns.forEach((turn, index) => {
        const now = turn.at === undefined ? previous : at(turn.at);
        const moved = now === previous ? "" : `，读到 ${now}`;
        previous = now;
        lines.push("", `第 ${index + 1} 轮（${STATUS_WORDS[turn.status]}${moved}）：${turn.question}`, "", ...turnBody(turn, conversation.mode));
    });
    return lines.join("\n");
}

/** 列表里的一行：一个对话。 */
export function conversationLine(conversation: QaConversation): string {
    const last = conversation.turns.at(-1)!;
    return `${conversation.id}  ${conversation.startedAt.slice(0, 16).replace("T", " ")}  ${STATUS_WORDS[last.status]}  ${conversation.turns.length} 轮  @${at(currentPosition(conversation))}  ${conversation.turns[0]!.question}`;
}
