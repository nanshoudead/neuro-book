/**
 * 内置问答的引擎（docs/specs/story/qa.md）：一问一个 Agent，从开始答到交卷、失败或被取消，结束时写下一条记录。
 * `nbstory ask` 与以后的网页问答页都调这里。
 *
 * 一问的顺序：
 * 1. 读配置得模型；固定书的一代；用 `book.info` 落定阅读位置。查询类失败在这里以 StoryError 抛出，全读超上限以
 *    QaError 抛出：这时还没开始运行，不写记录。
 * 2. 为这一问新建登记表、登记工具，建内存里的会话日志与 harness，`turn(问题)`。
 * 3. 按停止原因分派：交卷即已答；停止或输出到上限而没交卷时提醒，至多两次；出错为失败；取消为中断。
 * 4. 关 harness，把会话日志排成 JSONL 与记录一起保存。运行期间书库里不写任何东西：删除书的改名与
 *    递归删除不会和一问的写入交错（见 core/qa-records.ts）。
 * 第 2、3 步里 harness 抛出的错误（不是作为结果返回的）都是本机故障：收成 `model_failed`（`local`）的失败记录，
 * 不让它逃出这个函数；保存失败不改变这一问的结果，只在返回值里说明记录没保存。
 */

import {createHarness, createToolRegistry, registerPlugin, type Harness, type HarnessOptions, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog} from "@notnotype/nb-session";

import type {StoryApi} from "../core/api";
import type {Position} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";
import {newQaRecordId, QaRecords, type QaMode, type QaRecord, type QaUsage} from "../core/qa-records";
import {configuredModel, qaLimits, thinkingOption, type QaConfig} from "./config";
import {QaError} from "./errors";
import {ReadLedger} from "./read-ledger";
import profile from "./story-qa.profile";
import {storyQaPlugin, type QaToolState} from "./tools";

/** 没交卷就停下时的提醒（输出 10）。 */
export const REMINDER = "你还没有交卷。请用 answer 工具单独交出答案；找不到依据时，结论类型写“无法确定”并说明查过哪里。";
const MAX_REMINDERS = 2;

export type QaProgress =
    | {kind: "tool"; tool: string; text: string}
    | {kind: "rejected"; text: string}
    | {kind: "reminder"}
    | {kind: "answered"};

export interface AskInput {
    api: StoryApi;
    book?: string;
    at?: PositionInput;
    mode: QaMode;
    question: string;
    config: QaConfig;
    signal?: AbortSignal;
    onProgress?: (event: QaProgress) => void;
    /** 透传给 nb-harness 的 `createHarness`（它的公开选项）；测试用脚本化模型。 */
    streamFn?: HarnessOptions["streamFn"];
}

/** 记录没保存的原因：书删了或换了代、格式不认识只读，或写盘失败（附说明）。 */
export type NotSaved = {reason: "book_not_found" | "unsupported_format"} | {reason: "write_failed"; message: string};

export type QaOutcome = {record: QaRecord} & ({recordSaved: true} | {recordSaved: false; notSaved: NotSaved});

function emptyUsage(): QaUsage {
    return {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true};
}

function addUsage(total: QaUsage, usage: TurnResult["usage"]): QaUsage {
    return {
        input: total.input + usage.input,
        output: total.output + usage.output,
        cacheRead: total.cacheRead + usage.cacheRead,
        cacheWrite: total.cacheWrite + usage.cacheWrite,
        cost: total.cost === null || usage.cost === null ? null : total.cost + usage.cost,
        complete: total.complete && usage.complete,
    };
}

function positionText(position: {chapter: number; paragraph?: number}): string {
    return position.paragraph === undefined ? `${position.chapter}` : `${position.chapter}.${position.paragraph}`;
}

/** 进度里给人看的一句：工具名加主要参数。 */
function describeTool(tool: string, args: Record<string, unknown>): string {
    const words: Record<string, string> = {
        info: "看目录", chapter: "看本章变化", find: "找对象", card: "查人物卡", knowledge: "查他知道的事", statements: "查关于他的说法", appearances: "查他参与的情节",
        ties: "查关系", between: "查两人之间", relations: "查关系总表", knows: "查秘密矩阵", ledger: "查数值", track: "查数值流水", questions: "查悬念", timeline: "查时间线",
        episodes: "查情节", arcs: "查主线", search: "搜索", read: "读原文", para: "查某段的记录", answer: "交卷",
    };
    const word = words[tool] ?? tool;
    if (tool === "read" && typeof args.from === "object" && args.from !== null) {
        const from = positionText(args.from as PositionInput);
        return `${word} ${from}${typeof args.to === "object" && args.to !== null ? `—${positionText(args.to as PositionInput)}` : ""}`;
    }
    if (tool === "chapter" || tool === "para") return `${word}：第 ${String(args.chapter)} 章${args.paragraph === undefined ? "" : `第 ${String(args.paragraph)} 段`}`;
    const subject = [args.entity, args.other, args.query, args.track].filter(value => typeof value === "string").join("、");
    return subject === "" ? word : `${word}：${subject}`;
}

/** 全读的第一条消息：P 以前的全部原文，再接问题。超上限报 full_read_unavailable（F3）。 */
async function fullReadMessage(input: AskInput, book: Awaited<ReturnType<StoryApi["openBook"]>>, at: Position, maxChars: number): Promise<string> {
    const outcome = await book.call("source.read", {at, from: {chapter: 1, paragraph: 1}, to: at});
    if (!outcome.ok) throw new StoryError(outcome.error.code, outcome.error.message);
    const paragraphs = outcome.value.paragraphs;
    const chars = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    if (chars > maxChars) throw new QaError("full_read_unavailable", `阅读位置 ${at.chapter}.${at.paragraph} 以前的原文有 ${chars} 字，超过全读上限 ${maxChars} 字：改用图当目录，或调大 fullReadMaxChars`);
    return `以下是阅读位置以前的全部原文：\n${paragraphs.map(item => `${item.chapter}.${item.paragraph} ${item.text}`).join("\n")}\n\n问题：${input.question}`;
}

export async function askQuestion(input: AskInput): Promise<QaOutcome> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const model = configuredModel(input.config);
    const limits = qaLimits(input.config);
    const book = await input.api.openBook(input.book);
    const info = await book.call("book.info", input.at === undefined ? {} : {at: input.at});
    if (!info.ok) throw new StoryError(info.error.code, info.error.message);
    const at: Position = info.value.at;
    const firstMessage = input.mode === "full" ? await fullReadMessage(input, book, at, limits.fullReadMaxChars) : input.question;

    const id = newQaRecordId(new Date(started));
    const ledger = new ReadLedger({paragraphs: book.meta.paragraphs, at, maxChapters: input.mode === "graph" ? limits.maxChapters : null, readAll: input.mode === "full"});
    const state: QaToolState = {book, at, ledger, answer: null};
    // 作答被退回的次数：不只是我们的校验，OMP 的参数校验与“收尾要单独调用”的退回也算，所以按工具结束事件数。
    let rejections = 0;
    const registry = createToolRegistry();
    registerPlugin(registry, storyQaPlugin(state));
    const sessionLog = createMemorySessionLog({sessionId: id});

    let usage = emptyUsage();
    let outcome: Pick<QaRecord, "status" | "answer" | "error"> = {status: "interrupted", answer: null, error: null};
    let harness: Harness | null = null;
    try {
        harness = await createHarness({
            profile,
            initial: {title: book.meta.title, at: `${at.chapter}.${at.paragraph}`, mode: input.mode, maxChapters: input.mode === "graph" ? limits.maxChapters : null},
            registry,
            model,
            sessionLog,
            ...thinkingOption(input.config),
            ...(input.streamFn === undefined ? {} : {streamFn: input.streamFn}),
        });
        harness.subscribe(event => {
            if (event.type === "tool_execution_start") input.onProgress?.({kind: "tool", tool: event.toolName, text: describeTool(event.toolName, (event.args ?? {}) as Record<string, unknown>)});
            if (event.type === "tool_execution_end" && event.toolName === "answer" && event.isError) {
                rejections += 1;
                const result = event.result as {content?: {type: string; text?: string}[]} | undefined;
                input.onProgress?.({kind: "rejected", text: result?.content?.map(block => block.text ?? "").join("") ?? ""});
            }
        });

        let result = await harness.turn(firstMessage, input.signal === undefined ? undefined : {signal: input.signal});
        usage = addUsage(usage, result.usage);
        for (let reminders = 0; ; reminders += 1) {
            if (result.stopReason === "finished" && state.answer !== null) {
                outcome = {status: "answered", answer: state.answer, error: null};
                input.onProgress?.({kind: "answered"});
                break;
            }
            if (result.stopReason === "error") {
                const error = result.error!;
                outcome = {status: "failed", answer: null, error: {code: "model_failed", kind: error.kind, message: error.message}};
                break;
            }
            if (result.stopReason === "aborted") break;
            // stop 或 length：没有交卷。
            if (reminders >= MAX_REMINDERS) {
                outcome = {status: "failed", answer: null, error: {code: "no_answer", message: `提醒 ${MAX_REMINDERS} 次后仍没有交出通过校验的答案`}};
                break;
            }
            input.onProgress?.({kind: "reminder"});
            result = await harness.turn(REMINDER, input.signal === undefined ? undefined : {signal: input.signal});
            usage = addUsage(usage, result.usage);
        }
    } catch (error) {
        outcome = {status: "failed", answer: null, error: {code: "model_failed", kind: "local", message: `本机错误：${error instanceof Error ? error.message : String(error)}`}};
    }
    try {
        await harness?.close();
    } catch (error) {
        if (outcome.status !== "failed") outcome = {status: "failed", answer: null, error: {code: "model_failed", kind: "local", message: `关闭会话失败：${error instanceof Error ? error.message : String(error)}`}};
    }

    const record: QaRecord = {
        id,
        book: book.id,
        generation: book.generation,
        question: input.question,
        at,
        mode: input.mode,
        ...outcome,
        chaptersRead: ledger.chapters(),
        rejections,
        usage,
        ms: Date.now() - started,
        model: input.config.model.id,
        startedAt,
    };
    const entries = await sessionLog.read();
    let saved: Awaited<ReturnType<QaRecords["save"]>>;
    try {
        saved = await new QaRecords(input.api.library, book.id).save(record, entries.map(entry => `${JSON.stringify(entry)}\n`).join(""));
    } catch (error) {
        return {record, recordSaved: false, notSaved: {reason: "write_failed", message: error instanceof Error ? error.message : String(error)}};
    }
    return saved.saved ? {record, recordSaved: true} : {record, recordSaved: false, notSaved: {reason: saved.reason}};
}
