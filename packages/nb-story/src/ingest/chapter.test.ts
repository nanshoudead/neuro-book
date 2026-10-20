/**
 * 抽一章（docs/specs/story/ingest.md 输出 4、5、7、9、10，验收 5）。请求经真实的 OpenAI SDK 与 HTTP 发往本机端点。
 *
 * 回放：端点给出 w00005 t34 抽样例书时录下的回复（testing/ingest-replay.ts）。管线搬得对，发出的每个请求就与当时的
 * 逐字相同、各章最终草稿与整理稿也相同。唯一允许的差别是核对清单里“格式不对：”后面的校验说明（原来是 zod 的措辞，
 * 现在是 TypeBox 的）。
 *
 * 故障：在回放上替换某一步的回复，等待由注入的函数记下，不真的等。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {loadReplay, replay, type ReplayKey} from "../../testing/ingest-replay";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {sampleDataset} from "../../testing/sample";
import type {Dataset, SourceChapter} from "../core/dataset";
import {consolidate, extractChapter, IngestBadReply, type ChapterRun, type Step} from "./chapter";
import {compile, sourceChapter} from "./compile";
import type {RawDraft} from "./draft-tools";
import {ModelError, RETRY_DELAYS_MS, type Attempt} from "./model";

const FIXTURES = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest");
const gunzipJson = async <T>(name: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as T;

/** 核对清单里“格式不对：”后面的校验说明换成固定文字（见模块头）。 */
const withoutSchemaDetails = (text: string) => text.replace(/格式不对：[^\n]*/gu, "格式不对：…");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let endpoint: Endpoint | undefined;
afterEach(() => {
    endpoint?.stop();
    endpoint = undefined;
});

/** 起端点并记下每次请求：认出的步骤、系统提示词加用户消息的摘要、推理档。 */
function serve(respond: (body: Record<string, unknown>, index: number) => EndpointReply, keyOf?: () => ReplayKey | undefined) {
    const requests: {key: string; sha256: string; normalized: string; effort: unknown}[] = [];
    endpoint = startEndpoint((body, index) => {
        const reply = respond(body, index);
        const messages = body.messages as {content: string}[];
        const key = keyOf?.();
        const full = `${messages[0]!.content}\n\u0000\n${messages[1]!.content}`;
        requests.push({key: key ? `${key.chapter}:${key.step}` : String(index), sha256: sha256(full), normalized: sha256(withoutSchemaDetails(full)), effort: body.reasoning_effort});
        return reply;
    });
    const waits: number[] = [];
    const attempts: {step: Step; attempt: Attempt}[] = [];
    const run: ChapterRun = {
        endpoint: {baseUrl: endpoint.url, model: "gpt-6-luna", apiKey: "test-credential", maxTokens: 32_000},
        sleep: async ms => {
            waits.push(ms);
        },
        onAttempt: (step, attempt) => attempts.push({step, attempt}),
    };
    return {run, requests, waits, attempts};
}

/** 按顺序抽前 `count` 章（第 5、10 章后整理），返回各章草稿、整理稿与每章的结果。 */
async function extractBook(sample: Dataset, count: number, run: ChapterRun) {
    const drafts: RawDraft[] = [];
    const consolidations: unknown[] = [];
    const sources = (through: number) => sample.sources.filter(source => source.chapter <= through);
    const results = [];
    for (let chapter = 1; chapter <= count; chapter++) {
        const prior = chapter > 1 ? compile(sample.book, sources(chapter - 1), drafts, consolidations).dataset : null;
        const result = await extractChapter({source: sample.sources[chapter - 1]!, prior, compileWith: candidate => compile(sample.book, sources(chapter), [...drafts, candidate], consolidations)}, run);
        results.push(result);
        drafts.push(result.draft);
        if (chapter % 5 === 0) {
            const dataset = compile(sample.book, sources(chapter), drafts, consolidations).dataset;
            const outcome = await consolidate(chapter, dataset, candidate => compile(sample.book, sources(chapter), drafts, [...consolidations, candidate]), run);
            if (outcome.consolidation) consolidations.push(outcome.consolidation);
        }
    }
    return {drafts, consolidations, results};
}


describe("回放前 10 章（输出 4、7）", () => {
    test("发出的每个请求、各章最终草稿与整理稿都与 t34 那次相同", async () => {
        const sample = await sampleDataset();
        const data = await loadReplay();
        const final = await gunzipJson<{drafts: unknown[]; consolidations: unknown[]}>("run-med-100-final.json.gz");
        const recordedRequests = await gunzipJson<Record<string, Record<string, {sha256: string; normalized: string; effort: string}>>>("recorded-requests-ch001-010.json.gz");
        const played = replay(data);
        const {run, requests} = serve(played.responder, () => played.seen.at(-1));

        const {drafts, consolidations, results} = await extractBook(sample, 10, run);
        expect(played.unknown).toEqual([]);
        expect(drafts).toEqual(final.drafts.slice(0, 10) as RawDraft[]);
        expect(consolidations).toEqual(final.consolidations.slice(0, 2));
        expect(results.map(result => result.dropped)).toEqual(Array(10).fill(0));

        // 每一步都发了，而且只发了一次；推理档与当时相同。
        expect(requests.map(request => request.key).sort()).toEqual(Object.entries(recordedRequests).flatMap(([chapter, steps]) => Object.keys(steps).map(step => `${chapter}:${step}`)).sort());
        for (const request of requests) {
            const [chapter, step] = request.key.split(":") as [string, string];
            const recorded = recordedRequests[chapter]![step]!;
            expect({key: request.key, effort: request.effort}).toEqual({key: request.key, effort: recorded.effort});
            // 逐字相同；不同时只能是核对清单里的校验说明不同，而且只在核对类请求里。
            const same = request.sha256 === recorded.sha256 ? "same" : request.normalized === recorded.normalized && step === "review-1" ? "schema details only" : "different";
            expect({key: request.key, same}).not.toEqual({key: request.key, same: "different"});
        }
    }, 120_000);
});

describe("渠道失败与不成形的回复（输出 9、10，验收 5）", () => {
    /** 只抽第 1 章，替换其中某一步的回复。 */
    async function chapterOne(override: (key: ReplayKey, nth: number) => EndpointReply | undefined) {
        const sample = await sampleDataset();
        const played = replay(await loadReplay(), override);
        const served = serve(played.responder, () => played.seen.at(-1));
        const outcome = await extractChapter({source: sample.sources[0]!, prior: null, compileWith: candidate => compile(sample.book, sample.sources.slice(0, 1), [candidate])}, served.run).then(
            result => ({ok: true as const, result}),
            (error: unknown) => ({ok: false as const, error}),
        );
        const steps = (step: ReplayKey["step"]) => played.seen.filter(key => key.step === step).length;
        return {...served, outcome, steps, played};
    }
    const status = (code: number): EndpointReply => ({kind: "status", status: code});

    test("草稿请求先回两次 503：等 30、60 秒重发，这一章照常抽完，端点共收到 3 次草稿请求", async () => {
        const run = await chapterOne((key, nth) => (key.step === "draft" && nth <= 2 ? status(503) : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000, 60_000]);
        expect(run.steps("draft")).toBe(3);
    });

    test("一直回 503：同一请求合计 6 次 HTTP 后以 network 失败，等待用完整张延迟表", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? status(503) : undefined));
        expect(run.outcome.ok).toBe(false);
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("network");
        expect(run.steps("beats")).toBe(6);
        expect(run.waits).toEqual(RETRY_DELAYS_MS);
    });

    test("401 不重发：以 auth 失败，错误里没有密钥", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? {kind: "status", status: 401, echoKey: true} : undefined));
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("auth");
        expect(run.steps("beats")).toBe(1);
        expect(!run.outcome.ok && String((run.outcome.error as Error).message)).not.toContain("test-credential");
    });

    test("拒绝 minimal 推理档：不降档、不重发，以 provider 失败；请求里的推理档是 minimal", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? status(400) : undefined));
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("provider");
        expect(run.requests.map(request => request.effort)).toEqual(["minimal"]);
    });

    test("跑飞：一段内容之后只剩空白，2000 个空白后中止、按渠道失败重发；那次的用量标不完整", async () => {
        const run = await chapterOne((key, nth) => (key.step === "beats" && nth === 1 ? {kind: "runaway", text: '{"chapter":1,"times":[' } : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000]);
        const beats = run.attempts.filter(item => item.step === "beats").map(item => ({ok: item.attempt.error === null, complete: item.attempt.usage.complete}));
        expect(beats).toEqual([{ok: false, complete: false}, {ok: true, complete: true}]);
    });

    test("流没有结束原因就断了：按渠道失败重发", async () => {
        const run = await chapterOne((key, nth) => (key.step === "draft" && nth === 1 ? {kind: "cut", text: '{"chapter":1'} : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000]);
    });

    test("回复不是 JSON：重发一次（不等待）就好了；两次都不是：ingest_bad_reply", async () => {
        const once = await chapterOne((key, nth) => (key.step === "beats" && nth === 1 ? {kind: "text", text: "好的，这就写。"} : undefined));
        expect(once.outcome.ok).toBe(true);
        expect(once.waits).toEqual([]);
        expect(once.steps("beats")).toBe(2);
        endpoint?.stop();
        const twice = await chapterOne(key => (key.step === "beats" ? {kind: "text", text: "好的，这就写。"} : undefined));
        expect(!twice.outcome.ok && twice.outcome.error instanceof IngestBadReply && twice.outcome.error.step).toBe("beats");
    });

    test("被截断、没有段落块、草稿缺本章：重发一次后仍是这样，ingest_bad_reply", async () => {
        const cases: [ReplayKey["step"], EndpointReply][] = [
            ["draft", {kind: "text", text: '{"chapter":1,"entities":[]}', finishReason: "length"}],
            ["beats", {kind: "text", text: '{"chapter":1,"times":[],"beats":[]}'}],
            ["draft", {kind: "text", text: '{"chapter":2,"entities":[]}'}],
        ];
        for (const [step, reply] of cases) {
            const run = await chapterOne(key => (key.step === step ? reply : undefined));
            expect({step, error: !run.outcome.ok && run.outcome.error instanceof IngestBadReply}).toEqual({step, error: true});
            expect(run.steps(step)).toBe(2);
            endpoint?.stop();
        }
    });
});

describe("整理不合格（输出 7）", () => {
    test("整理的回复两次都不是 JSON：跳过这一次，不抛错", async () => {
        const sample = await sampleDataset();
        const data = await loadReplay();
        const played = replay(data, key => (key.step === "consolidation" ? {kind: "text", text: "整理不了。"} : undefined));
        const {run} = serve(played.responder, () => played.seen.at(-1));
        const final = await gunzipJson<{drafts: unknown[]}>("run-med-100-final.json.gz");
        const sources = sample.sources.slice(0, 5);
        const dataset = compile(sample.book, sources, final.drafts.slice(0, 5)).dataset;
        const outcome = await consolidate(5, dataset, candidate => compile(sample.book, sources, final.drafts.slice(0, 5), [candidate]), run);
        expect(outcome.consolidation).toBeNull();
        expect(outcome.problems.join("")).toContain("整理跳过");
    });
});

describe("全图的时间矛盾（输出 5）", () => {
    /** 两章的小书：第 1 章有一个第一天正午的时间点；第 2 章的回复写了“第一天早晨、却在正午之后”，与第 1 章矛盾。 */
    const sources: SourceChapter[] = [sourceChapter(1, "第1章", ["第1章", "正午。"]), sourceChapter(2, "第2章", ["第2章", "早晨。", "晚上。"])];
    const chapterOneDraft = {chapter: 1, times: [{id: "t1-1", label: "第一天正午", day: 1, part: "noon", at: ["1.2"]}], beats: [{id: "b1-1", from: 1, to: 2, gist: "正午。", time: "t1-1"}]};

    test("这一章新带来的矛盾由丢弃这一章的时间点消除，照常抽完、丢弃计数；前一章不改", async () => {
        const replies: Record<string, EndpointReply> = {
            beats: {kind: "text", text: JSON.stringify({chapter: 2, times: [{id: "t2-1", label: "第一天早晨", day: 1, part: "morning", rel: [{type: "after", to: "t1-1"}], at: ["2.2"]}], beats: [{id: "b2-1", from: 1, to: 3, gist: "早晨到晚上。", time: "t2-1"}]})},
            draft: {kind: "text", text: JSON.stringify({chapter: 2})},
            check: {kind: "text", text: "{}"},
        };
        const {run} = serve(body => {
            const user = (body.messages as {content: string}[])[1]!.content;
            return user.includes("以及程序核对出的清单") ? replies.check! : user.includes("写草稿里除") ? replies.draft! : replies.beats!;
        });
        const prior = compile({id: "t", title: "t"}, sources.slice(0, 1), [chapterOneDraft]).dataset;
        const result = await extractChapter({source: sources[1]!, prior, compileWith: candidate => compile({id: "t", title: "t"}, sources, [chapterOneDraft, candidate])}, run);
        expect(result.draft.times).toEqual([]);
        expect(result.draft.beats?.map(beat => beat.time)).toEqual([null]);
        expect(result.dropped).toBe(1);
        expect(compile({id: "t", title: "t"}, sources, [chapterOneDraft, result.draft]).issues.filter(issue => issue.level === "error")).toEqual([]);
    });
});
