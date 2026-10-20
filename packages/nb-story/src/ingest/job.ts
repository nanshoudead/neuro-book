/**
 * 一次抽取任务（docs/specs/story/ingest.md 输出 4 到 11）：从书里已提交的下一章起逐章抽，第 5 的倍数章与原文末章
 * 先整理，再提交。调用方（runner.ts）已拿到这个 id 的抽取锁；这里只管“抽”和“提交”，不碰锁与状态文件。
 *
 * 停止有两个入口：`signal` 中止在途的模型请求与重试等待；`stopRequested()` 在每次模型请求之前与提交之前同步检查。
 * 后者是为了编译这类长时间的同步计算：编译期间收不到消息，但编译一结束、提交之前就能看到停止（计划审查第 6 条）。
 * 没提交的那一章作废，下次从头重做。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import type {Dataset, SourceChapter} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {Library} from "../core/library";
import {consolidate, extractChapter, IngestBadReply, type ChapterRun, type Step} from "./chapter";
import {compile} from "./compile";
import type {RawDraft} from "./draft-tools";
import {ModelAborted, ModelError, type Attempt, type ModelEndpoint} from "./model";
import type {IngestStore, UsageLine} from "./store";

/** 书目录里每次提交的抽取数据（core/library.ts 的 `extraction-<版本>.json`）。 */
export interface ExtractionData {
    through: number;
    drafts: RawDraft[];
    consolidations: unknown[];
    chapters: CommittedChapter[];
}

export interface CommittedChapter {
    chapter: number;
    /** 这一章从开始抽到提交的用时（不含之前作废的尝试）。 */
    ms: number;
    /** 兜底丢弃的记录条数。 */
    dropped: number;
    /** 留下的问题：编译警告、跳过的整理。 */
    problems: string[];
}

export type IngestEvent =
    | {type: "chapter"; chapter: number; total: number}
    | {type: "step"; chapter: number; step: Step}
    | {type: "retry"; chapter: number; step: Step; attempt: number; waitMs: number; message: string}
    | {type: "usage"; line: UsageLine}
    | {type: "committed"; chapter: number; total: number; ms: number; dropped: number; generation: string; revision: number};

export type JobOutcome = {kind: "done"} | {kind: "stopped"} | {kind: "failed"; code: string; errorKind?: string; message: string};

export interface JobOptions {
    library: Library;
    store: IngestStore;
    endpoint: ModelEndpoint;
    price: UsageLine["price"];
    /** 这次任务的编号（用量记账用）。 */
    run: string;
    signal: AbortSignal;
    stopRequested: () => boolean;
    onEvent: (event: IngestEvent) => void;
    sleep?: ChapterRun["sleep"];
    fetch?: ChapterRun["fetch"];
}

const CONSOLIDATE_EVERY = 5;

class Stopped extends Error {}

/** 书里已提交的抽取数据；书还不存在（第 1 章没提交）时为空。 */
export async function readCommitted(library: Library, id: string): Promise<{generation: string | undefined; data: ExtractionData}> {
    const meta = await library.readMeta(id).catch((error: unknown) => {
        if (error instanceof StoryError && error.code === "book_not_found") return null;
        throw error;
    });
    if (!meta) return {generation: undefined, data: {through: 0, drafts: [], consolidations: [], chapters: []}};
    if (!meta.extraction) throw new StoryError("book_exists", `书 ${id} 是导入数据文件得来的，不能抽取`);
    const data = JSON.parse(await readFile(join(library.bookDir(id), meta.extraction.file), "utf8")) as ExtractionData;
    return {generation: meta.generation, data};
}

export async function runIngest(options: JobOptions): Promise<JobOutcome> {
    const {library, store} = options;
    const source = await store.readSource();
    if (!source) return {kind: "failed", code: "book_not_found", message: `书 ${store.id} 没有抽取记录`};
    const book = {id: source.id, title: source.title};
    const total = source.chapters.length;
    let {generation, data} = await readCommitted(library, store.id);
    const sourcesThrough = (chapter: number): SourceChapter[] => source.chapters.filter(item => item.chapter <= chapter);
    const checkStop = () => {
        if (options.stopRequested() || options.signal.aborted) throw new Stopped();
    };
    let prior: Dataset | null = data.through > 0 ? compile(book, sourcesThrough(data.through), data.drafts, data.consolidations).dataset : null;
    // 用量记录边抽边写；提交前等它们都写完，有一笔写不进去就不提交（用量是要报告的数，不能悄悄少一笔）。
    const usageWrites: Promise<void>[] = [];

    try {
        for (let chapter = data.through + 1; chapter <= total; chapter++) {
            checkStop();
            options.onEvent({type: "chapter", chapter, total});
            const started = Date.now();
            const run = chapterRun(options, chapter, checkStop, usageWrites);
            const sources = sourcesThrough(chapter);
            const result = await extractChapter({source: source.chapters[chapter - 1]!, prior, compileWith: candidate => compile(book, sources, [...data.drafts, candidate], data.consolidations)}, run);
            const drafts = [...data.drafts, result.draft];
            let consolidations = data.consolidations;
            let dataset = compile(book, sources, drafts, consolidations).dataset;
            const problems = result.remaining.map(issue => issue.message);
            if (chapter % CONSOLIDATE_EVERY === 0 || chapter === total) {
                const outcome = await consolidate(chapter, dataset, candidate => compile(book, sources, drafts, [...consolidations, candidate]), run);
                problems.push(...outcome.problems);
                if (outcome.consolidation !== null) {
                    consolidations = [...consolidations, outcome.consolidation];
                    dataset = compile(book, sources, drafts, consolidations).dataset;
                }
            }
            await Promise.all(usageWrites.splice(0));
            checkStop();
            const committed: CommittedChapter = {chapter, ms: Date.now() - started, dropped: result.dropped, problems};
            const next: ExtractionData = {through: chapter, drafts, consolidations, chapters: [...data.chapters, committed]};
            const commit = await library.commitExtraction({id: store.id, title: source.title, generation, dataset, through: chapter, extraction: JSON.stringify(next)});
            generation = commit.generation;
            data = next;
            prior = dataset;
            options.onEvent({type: "committed", chapter, total, ms: committed.ms, dropped: committed.dropped, generation: commit.generation, revision: commit.revision});
        }
        return {kind: "done"};
    } catch (error) {
        if (error instanceof Stopped || error instanceof ModelAborted) return {kind: "stopped"};
        if (error instanceof ModelError) return {kind: "failed", code: "model_failed", errorKind: error.kind, message: error.message};
        if (error instanceof IngestBadReply) return {kind: "failed", code: "ingest_bad_reply", message: error.message};
        // 书在抽取期间被删除或换了一代：提交失败，任务停下，不往新的一代里写。
        if (error instanceof StoryError) return {kind: "failed", code: error.code, message: error.message};
        throw error;
    }
}

/** 一章的模型调用回调：步骤与重试转成事件，每次 HTTP 尝试记一行用量；每次请求之前检查停止。 */
function chapterRun(options: JobOptions, chapter: number, checkStop: () => void, usageWrites: Promise<void>[]): ChapterRun {
    return {
        endpoint: options.endpoint,
        signal: options.signal,
        ...(options.sleep ? {sleep: options.sleep} : {}),
        ...(options.fetch ? {fetch: options.fetch} : {}),
        onStep: step => {
            checkStop();
            options.onEvent({type: "step", chapter, step});
        },
        onRetry: (step, info) => options.onEvent({type: "retry", chapter, step, attempt: info.attempt, waitMs: info.waitMs, message: info.error.message}),
        onAttempt: (step, attempt: Attempt) => {
            const line: UsageLine = {
                run: options.run, chapter, step, attempt: attempt.attempt, ms: attempt.ms,
                input: attempt.usage.input, output: attempt.usage.output, cacheRead: attempt.usage.cacheRead, complete: attempt.usage.complete,
                error: attempt.error?.message ?? null, price: options.price, at: new Date().toISOString(),
            };
            options.onEvent({type: "usage", line});
            const write = options.store.appendUsage(line);
            // 先挂一个处理，免得在提交前等它之前就报“未处理的 reject”；失败照样在提交前的 Promise.all 里抛出。
            write.catch(() => undefined);
            usageWrites.push(write);
        },
    };
}
