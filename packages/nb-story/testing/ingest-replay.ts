/**
 * 抽取的回放：本机端点按“第几章、哪一步”给出 w00005 t34 抽样例书时录下的模型回复（tests/fixtures/ingest/）。
 *
 * 认请求看请求头 `X-Nbstory-Step`（src/ingest/model.ts 的 STEP_HEADER）：抽取每次调用都写明章、步骤与这一步的第几次，
 * 渠道重发时不变。不从正文推断：核对与修复在清单只有结构问题、核对没改草稿时，两次请求的正文完全相同（实现审查第 8
 * 条）。没有录下回复的请求记进 `unknown`，并回一个不可重试的错误，测试据此失败。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import type {EndpointReply, Responder} from "./openai-endpoint";

export type ReplayStep = "recall" | "beats" | "draft" | "review-1" | "repair-1" | "persona" | "consolidation";

export interface ReplayKey {
    chapter: number;
    step: ReplayStep;
    /** 这一步的第几次（回复不成形时重发算下一次；渠道重发不变）。 */
    round: number;
    /** 马甲核对问的是哪个马甲（同一章至多问几个，各自一次请求）。 */
    subject?: string;
}

interface Recorded {
    content: string;
    usage: Record<string, unknown> | null;
    finishReason: string | null;
}

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures", "ingest");

let recorded: Record<string, Record<string, Recorded>> | undefined;

/** 录下的回复：章号 → 步骤 → 回复（第 1 到 10 章与第 99、100 章）。进程内只解压一次。 */
export async function loadReplay(): Promise<Record<string, Record<string, Recorded>>> {
    if (!recorded) {
        const files = await Promise.all(["replay-ch001-010.json.gz", "replay-ch099-100.json.gz"].map(async name => JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as Record<string, Record<string, Recorded>>));
        recorded = Object.assign({}, ...files) as Record<string, Record<string, Recorded>>;
    }
    return recorded;
}

/** 请求头里的身份：`章/步骤/第几次`，马甲核对再带 `/马甲编号`；步骤是 recall、beats、draft、review、repair、persona、consolidation。 */
export function stepOf(headers: Headers): ReplayKey | null {
    const match = /^(\d+)\/(recall|beats|draft|review|repair|persona|consolidation)\/(\d+)(?:\/([a-z]\d+-\d+))?$/u.exec(headers.get("x-nbstory-step") ?? "");
    if (!match) return null;
    const step = match[2] === "review" ? "review-1" : match[2] === "repair" ? "repair-1" : (match[2] as ReplayStep);
    return {chapter: Number(match[1]), step, round: Number(match[3]), ...(match[4] ? {subject: match[4]} : {})};
}

export interface Replay {
    responder: Responder;
    /** 认出的每次请求，按到达顺序（渠道重发也各记一次）。 */
    readonly seen: ReplayKey[];
    /** 认不出、或没有录下回复的请求。 */
    readonly unknown: string[];
}

/**
 * 回放应答。`override` 对某一章某一步的第 `nth` 次请求（从 1 起，渠道重发与不成形重发都算）给出别的回复，用来注入
 * 渠道失败、坏回复等；返回 undefined 时照常回放。
 */
export function replay(data: Record<string, Record<string, Recorded>>, override?: (key: ReplayKey, nth: number) => EndpointReply | undefined): Replay {
    const seen: ReplayKey[] = [];
    const unknown: string[] = [];
    const asked = new Map<string, number>();
    const responder: Responder = (_body, _index, headers) => {
        const key = stepOf(headers);
        if (!key) {
            unknown.push("认不出的请求（没有 X-Nbstory-Step）");
            return {kind: "status", status: 418};
        }
        seen.push(key);
        const id = `${key.chapter}:${key.step}${key.subject ? `:${key.subject}` : ""}`;
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
