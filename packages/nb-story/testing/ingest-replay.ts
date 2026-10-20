/**
 * 抽取的回放：本机端点按“第几章、哪一步”给出 w00005 t34 抽样例书时录下的模型回复（tests/fixtures/ingest/）。
 *
 * 认请求只看请求正文里固定的文字：各步的【任务】开头不同，章号写在“【第 N 章原文】”或“读到第 N 章”里。核对与修复用同
 * 一个任务文字，按同一章里出现的先后区分（第一次是核对，第二次是修复）；正文与这一章上一次核对类请求完全相同的是
 * 渠道失败后的重发，算同一步。认不出、或这一步没有录下回复的请求记进
 * `unknown`，并回一个不可重试的错误，测试据此失败，不按请求顺序瞎回。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import type {EndpointReply, Responder} from "./openai-endpoint";

export type ReplayStep = "beats" | "draft" | "review-1" | "repair-1" | "consolidation";

export interface ReplayKey {
    chapter: number;
    step: ReplayStep;
}

interface Recorded {
    content: string;
    usage: Record<string, unknown> | null;
    finishReason: string | null;
}

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures", "ingest");

let recorded: Record<string, Record<string, Recorded>> | undefined;

/** 录下的回复：章号 → 步骤 → 回复。进程内只解压一次。 */
export async function loadReplay(): Promise<Record<string, Record<string, Recorded>>> {
    recorded ??= JSON.parse(gunzipSync(await readFile(join(FIXTURES, "replay-ch001-010.json.gz"))).toString("utf8")) as Record<string, Record<string, Recorded>>;
    return recorded;
}

/** 从请求正文认出第几章、哪一种任务；核对或修复先认成 `review-1`，由调用方按出现次数改。 */
function classify(body: Record<string, unknown>): {chapter: number; kind: "beats" | "draft" | "check" | "consolidation"} | null {
    const messages = body.messages as {role: string; content: string}[] | undefined;
    const user = messages?.find(message => message.role === "user")?.content ?? "";
    const consolidation = /【任务】读到第 (\d+) 章，做一次整理/u.exec(user);
    if (consolidation) return {chapter: Number(consolidation[1]), kind: "consolidation"};
    const chapter = Number(/【第 (\d+) 章原文】/u.exec(user)?.[1]);
    if (!chapter) return null;
    if (user.includes("写 times（本章新出现的时间点）和 beats（段落块）两部分")) return {chapter, kind: "beats"};
    if (user.includes("写草稿里除 times 和 beats 以外的全部内容")) return {chapter, kind: "draft"};
    if (user.includes("以及程序核对出的清单")) return {chapter, kind: "check"};
    return null;
}

export interface Replay {
    responder: Responder;
    /** 认出的每次请求，按到达顺序。 */
    readonly seen: ReplayKey[];
    /** 认不出、或没有录下回复的请求。 */
    readonly unknown: string[];
}

/**
 * 回放应答。`override` 对某一章某一步的第 `nth` 次请求（从 1 起，同一步重发也算）给出别的回复，用来注入渠道失败、
 * 坏回复等；返回 undefined 时照常回放。
 */
export function replay(data: Record<string, Record<string, Recorded>>, override?: (key: ReplayKey, nth: number) => EndpointReply | undefined): Replay {
    const seen: ReplayKey[] = [];
    const unknown: string[] = [];
    const lastCheck = new Map<number, {user: string; step: ReplayStep}>();
    const asked = new Map<string, number>();
    const responder: Responder = body => {
        const found = classify(body);
        if (!found) {
            unknown.push("认不出的请求");
            return {kind: "status", status: 418};
        }
        let step: ReplayStep;
        if (found.kind === "check") {
            const user = (body.messages as {role: string; content: string}[]).find(message => message.role === "user")!.content;
            const previous = lastCheck.get(found.chapter);
            step = previous === undefined ? "review-1" : previous.user === user ? previous.step : "repair-1";
            lastCheck.set(found.chapter, {user, step});
        } else step = found.kind;
        const key = {chapter: found.chapter, step};
        seen.push(key);
        const id = `${key.chapter}:${key.step}`;
        const nth = (asked.get(id) ?? 0) + 1;
        asked.set(id, nth);
        const injected = override?.(key, nth);
        if (injected) return injected;
        const reply = data[String(key.chapter)]?.[key.step];
        if (!reply) {
            unknown.push(`第 ${key.chapter} 章 ${key.step} 没有录下回复`);
            return {kind: "status", status: 418};
        }
        return {kind: "text", text: reply.content, finishReason: reply.finishReason ?? "stop", ...(reply.usage ? {usage: reply.usage} : {})};
    };
    return {responder, seen, unknown};
}
