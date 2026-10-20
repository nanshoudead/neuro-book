/**
 * 抽取进度（docs/specs/story/ingest.md 输出 13）。
 *
 * 提交到第几章以书为准（book.json 指向的抽取数据），state.json 只补瞬时的东西（由谁运行、当前步骤、在等的重试、
 * 停下的原因）。是否真在运行以抽取锁为准：拿得到锁就没有任务在跑，这时 state.json 还写着运行中，说明运行它的进程
 * 已经退出（被强行结束或崩溃）。
 */

import {readdir} from "node:fs/promises";
import {join} from "node:path";

import {systemErrorCode} from "../core/errors";
import type {Library} from "../core/library";
import {readCommitted} from "./job";
import {IngestStore, type RunnerKind, type StopReason, type UsageLine} from "./store";

/** 一组用量的合计。费用只在记了单价时才有；有任何一次请求的用量拿不到时 `complete` 为 false（数值是下界）。 */
export interface UsageTotals {
    /** 模型请求的用时合计（毫秒）。 */
    ms: number;
    input: number;
    output: number;
    cacheRead: number;
    cost: number | null;
    currency: string | null;
    complete: boolean;
}

export interface ChapterProgress {
    chapter: number;
    title: string;
    /** 从开始抽这一章到提交的用时（毫秒）。 */
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
    current: {chapter: number | null; step: string | null; retry: {attempt: number; waitMs: number; until: string} | null} | null;
    thisRun: UsageTotals;
    allRuns: UsageTotals;
    /** 每章平均：分子含失败与作废的尝试，分母是已提交的章数；还没有提交的章时为 null。 */
    average: {ms: number; cost: number | null} | null;
    chapters: ChapterProgress[];
}

function totals(lines: UsageLine[]): UsageTotals {
    let cost: number | null = null;
    let currency: string | null = null;
    for (const line of lines) {
        if (!line.price) continue;
        const uncached = Math.max(0, line.input - line.cacheRead);
        cost = (cost ?? 0) + (uncached * line.price.input + line.cacheRead * (line.price.cacheRead ?? line.price.input) + line.output * line.price.output) / 1_000_000;
        currency ??= line.price.currency;
    }
    return {
        ms: lines.reduce((sum, line) => sum + line.ms, 0),
        input: lines.reduce((sum, line) => sum + line.input, 0),
        output: lines.reduce((sum, line) => sum + line.output, 0),
        cacheRead: lines.reduce((sum, line) => sum + line.cacheRead, 0),
        cost, currency,
        complete: lines.every(line => line.complete),
    };
}

/** 一个书 id 的进度；没有抽取记录时为 null。 */
export async function ingestStatus(library: Library, id: string): Promise<IngestStatus | null> {
    const store = new IngestStore(library, id);
    const source = await store.readSource();
    if (!source) return null;
    const [{data}, state, usage] = await Promise.all([readCommitted(library, id), store.readState(), store.readUsage()]);
    const lock = await store.tryLock();
    const running = lock === null;
    lock?.release();
    const total = source.chapters.length;
    const done = data.through >= total;
    const status: IngestStatus["state"] = running ? "running" : done ? "done" : "stopped";
    let stopReason: StopReason | null = null;
    if (status === "stopped") stopReason = state?.state === "running" ? {kind: "exited"} : state?.stopReason ?? null;
    const thisRun = state ? usage.filter(line => line.run === state.run) : [];
    const chapters: ChapterProgress[] = data.chapters.map(chapter => ({
        chapter: chapter.chapter,
        title: source.chapters[chapter.chapter - 1]?.title ?? "",
        ms: chapter.ms,
        usage: totals(usage.filter(line => line.chapter === chapter.chapter)),
        dropped: chapter.dropped,
    }));
    const all = totals(usage);
    return {
        id, title: source.title, state: status,
        runner: running ? state?.runner ?? null : null,
        stopReason,
        total, committed: data.through,
        current: running && state ? {chapter: state.chapter, step: state.step, retry: state.retry} : null,
        thisRun: totals(thisRun),
        allRuns: all,
        average: data.through > 0 ? {ms: chapters.reduce((sum, chapter) => sum + chapter.ms, 0) / data.through, cost: all.cost === null ? null : all.cost / data.through} : null,
        chapters,
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
    const statuses = await Promise.all(names.filter(name => !name.startsWith(".")).map(name => ingestStatus(library, name)));
    return statuses.filter((status): status is IngestStatus => status !== null).sort((a, b) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id));
}
