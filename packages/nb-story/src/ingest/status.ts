/**
 * 抽取进度（docs/specs/story/ingest.md 输出 13）。
 *
 * 提交到第几章以书为准（book.json 指向的抽取数据），state.json 只补瞬时的东西（由谁运行、当前步骤、在等的重试、
 * 停下的原因）。是否真在运行以抽取锁为准：拿得到锁就没有任务在跑，这时 state.json 还写着运行中，说明运行它的进程
 * 已经退出（被强行结束或崩溃）。
 *
 * 用量：每次 HTTP 尝试有“开始”与“结算”两行；只有开始的那次是进程中途被杀，用量不知道，合计标为不完整。费用按
 * 币种分开合计，不做换算（停下后换了模型与价格再接着抽是合法的）。用时按 activity.jsonl 里任务与每章每次尝试的
 * 起止算，作废的尝试也算；没有结束时间的（进程被杀）算到它最后一次留下记录为止。
 */

import {readdir} from "node:fs/promises";
import {join} from "node:path";

import {featuresOf, type BookFeatures} from "../core/dataset";
import {StoryError, systemErrorCode} from "../core/errors";
import {isValidBookId, type Library} from "../core/library";
import type {Step} from "./chapter";
import {readCommitted} from "./job";
import {IngestStore, type ActivityLine, type RunnerKind, type StopReason, type UsageLine} from "./store";

/** 一组用量的合计。`costs` 按币种分开（记了单价的才有）；有任何一次请求的用量拿不到时 `complete` 为 false（数值是下界）。 */
export interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    costs: {currency: string; amount: number}[];
    complete: boolean;
}

export interface ChapterProgress {
    chapter: number;
    title: string;
    /** 这一章所有尝试（含作废的）的用时合计（毫秒）。 */
    ms: number;
    /** 这一章所有请求（含作废与失败的尝试）的用量。 */
    usage: UsageTotals;
    dropped: number;
}

export interface IngestStatus {
    id: string;
    title: string;
    state: "running" | "stopped" | "done";
    runner: RunnerKind | null;
    stopReason: StopReason | null;
    total: number;
    committed: number;
    current: {chapter: number | null; step: Step | null; retry: {attempt: number; waitMs: number; until: string} | null} | null;
    /** 这次任务与历次合计：用时（毫秒）与用量。 */
    thisRun: UsageTotals & {ms: number};
    allRuns: UsageTotals & {ms: number};
    /** 每章平均：分子含失败与作废的尝试，分母是已提交的章数；还没有提交的章时为 null。 */
    average: {ms: number; costs: {currency: string; amount: number}[]} | null;
    chapters: ChapterProgress[];
    /** 新建时定下的开关。 */
    features: BookFeatures;
}

const time = (at: string) => Date.parse(at);

/** 一次尝试按它当时记下的单价算的费用；没有单价时为 null。单价按每百万 token，缓存命中的部分按缓存价。 */
export function lineCost(line: Extract<UsageLine, {kind: "end"}>): {currency: string; amount: number} | null {
    if (!line.price) return null;
    const uncached = Math.max(0, line.input - line.cacheRead);
    return {currency: line.price.currency, amount: (uncached * line.price.input + line.cacheRead * (line.price.cacheRead ?? line.price.input) + line.output * line.price.output) / 1_000_000};
}

/** 按币种分开合计。 */
export function sumCosts(costs: Iterable<{currency: string; amount: number} | null>): {currency: string; amount: number}[] {
    const sums = new Map<string, number>();
    for (const cost of costs) if (cost) sums.set(cost.currency, (sums.get(cost.currency) ?? 0) + cost.amount);
    return [...sums].map(([currency, amount]) => ({currency, amount}));
}

function usageTotals(lines: UsageLine[]): UsageTotals {
    const ends = new Map<string, Extract<UsageLine, {kind: "end"}>>();
    for (const line of lines) if (line.kind === "end") ends.set(line.id, line);
    const settled = [...ends.values()];
    const unsettled = lines.some(line => line.kind === "start" && !ends.has(line.id));
    return {
        input: settled.reduce((sum, line) => sum + line.input, 0),
        output: settled.reduce((sum, line) => sum + line.output, 0),
        cacheRead: settled.reduce((sum, line) => sum + line.cacheRead, 0),
        costs: sumCosts(settled.map(lineCost)),
        complete: !unsettled && settled.every(line => line.complete),
    };
}

/** 每次任务的起止；没有结束记录的，结束取它最后留下的任何记录的时间（运行中的取现在）。 */
function runSpans(activity: ActivityLine[], usage: UsageLine[], running: string | null): Map<string, {start: number; end: number}> {
    const spans = new Map<string, {start: number; end: number}>();
    for (const line of activity) if (line.kind === "run-start") spans.set(line.run, {start: time(line.at), end: time(line.at)});
    for (const line of [...activity, ...usage]) {
        const span = spans.get(line.run);
        if (span) span.end = Math.max(span.end, time(line.at));
    }
    for (const line of activity) {
        if (line.kind !== "run-end") continue;
        const span = spans.get(line.run);
        if (span) span.end = time(line.at);
    }
    if (running) {
        const span = spans.get(running);
        if (span) span.end = Date.now();
    }
    return spans;
}

/** 每章所有尝试的用时；没有结束记录的尝试算到它所在任务的结束。 */
function chapterTimes(activity: ActivityLine[], spans: Map<string, {start: number; end: number}>): Map<number, number> {
    const times = new Map<number, number>();
    const open = new Map<string, number>();
    const add = (chapter: number, ms: number) => times.set(chapter, (times.get(chapter) ?? 0) + Math.max(0, ms));
    for (const line of activity) {
        if (line.kind === "chapter-start") open.set(`${line.run}:${line.chapter}`, time(line.at));
        else if (line.kind === "chapter-end") {
            const key = `${line.run}:${line.chapter}`;
            const start = open.get(key);
            if (start !== undefined) add(line.chapter, time(line.at) - start);
            open.delete(key);
        }
    }
    for (const [key, start] of open) {
        const [run, chapter] = key.split(":") as [string, string];
        add(Number(chapter), (spans.get(run)?.end ?? start) - start);
    }
    return times;
}

/** 一个书 id 的进度；没有抽取记录时为 null。 */
export async function ingestStatus(library: Library, id: string): Promise<IngestStatus | null> {
    if (!isValidBookId(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
    const store = new IngestStore(library, id);
    const source = await store.readSource();
    if (!source) return null;
    const [{data}, state, usage, activity] = await Promise.all([readCommitted(library, id), store.readState(), store.readUsage(), store.readActivity()]);
    const lock = await store.tryLock();
    const running = lock === null;
    lock?.release();
    const total = source.chapters.length;
    const status: IngestStatus["state"] = running ? "running" : data.through >= total ? "done" : "stopped";
    let stopReason: StopReason | null = null;
    if (status === "stopped") stopReason = state?.state === "running" ? {kind: "exited"} : state?.stopReason ?? null;

    const spans = runSpans(activity, usage, running && state ? state.run : null);
    const perChapter = chapterTimes(activity, spans);
    const thisRunSpan = state ? spans.get(state.run) : undefined;
    const allMs = [...spans.values()].reduce((sum, span) => sum + (span.end - span.start), 0);
    const all = usageTotals(usage);
    const chapters: ChapterProgress[] = data.chapters.map(chapter => ({
        chapter: chapter.chapter,
        title: source.chapters[chapter.chapter - 1]?.title ?? "",
        ms: perChapter.get(chapter.chapter) ?? 0,
        usage: usageTotals(usage.filter(line => line.chapter === chapter.chapter)),
        dropped: chapter.dropped,
    }));
    const spent = [...perChapter.values()].reduce((sum, ms) => sum + ms, 0);
    return {
        id, title: source.title, state: status,
        runner: running ? state?.runner ?? null : null,
        stopReason,
        total, committed: data.through,
        current: running && state ? {chapter: state.chapter, step: state.step, retry: state.retry} : null,
        thisRun: {...usageTotals(state ? usage.filter(line => line.run === state.run) : []), ms: thisRunSpan ? thisRunSpan.end - thisRunSpan.start : 0},
        allRuns: {...all, ms: allMs},
        average: data.through > 0 ? {ms: spent / data.through, costs: all.costs.map(cost => ({currency: cost.currency, amount: cost.amount / data.through}))} : null,
        chapters,
        features: featuresOf(source.features),
    };
}

/** 书库里所有有抽取记录的书 id 的进度。 */
export async function ingestStatuses(library: Library): Promise<IngestStatus[]> {
    let names: string[];
    try {
        names = await readdir(join(library.root, ".ingest"));
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return [];
        throw error;
    }
    const statuses = await Promise.all(names.filter(isValidBookId).map(name => ingestStatus(library, name)));
    return statuses.filter((status): status is IngestStatus => status !== null).sort((a, b) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id));
}
