/**
 * 内置问答的引擎（docs/specs/story/qa.md）：一个对话一个 Agent、一个会话，每问一轮；一轮从开始答到交卷、文字回复、
 * 失败或被取消，结束时写下整条对话记录。`nbstory ask` 与网页问答页都调这里。
 *
 * 一轮的顺序：
 * 1. 读配置得模型。新对话：固定书的一代，用 `book.info` 落定阅读位置，账本从空开始。续问（`continueFrom`）：读记录
 *    与会话日志，书、这一代、阅读位置、做法与章数上限都取记录里的，账本带上前几轮读过的段。查询类失败在这里以
 *    StoryError 抛出，全读超上限与续问不了以 QaError 抛出：这时还没开始运行，不写记录。
 * 2. 为这一轮新建登记表、登记工具，建内存里的会话日志（续问时带着读回的旧条目）与 harness，`turn(问题)`。
 * 3. 按停止原因定这一轮的结果（输出 10）；不再提醒。
 * 4. 关 harness，把会话日志排成 JSONL 与对话记录一起保存。运行期间书库里不写任何东西：删除书的改名与
 *    递归删除不会和写入交错（见 core/qa-records.ts）。
 * 第 2、3 步里 harness 抛出的错误（不是作为结果返回的）都是本机故障：收成 `model_failed`（`local`）的失败轮，
 * 不让它逃出这个函数；续问时恢复会话就失败的（Profile 或工具与快照不一致）在任何请求之前报 `qa_not_continuable`。
 * 保存失败不改变这一轮的结果，只在返回值里说明记录没保存。
 */

import {createHarness, createToolRegistry, HarnessError, registerPlugin, type Harness, type HarnessOptions, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog, parseEntryLine, type SessionEntry} from "@notnotype/nb-session";

import type {StoryApi} from "../core/api";
import type {BookFeatures, Position} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";
import {newQaRecordId, QaRecords, type QaConversation, type QaMode, type QaReply, type QaTurn, type QaUsage} from "../core/qa-records";
import {qaLimits, type QaConfig} from "./config";
import {configuredModel, thinkingOption} from "./harness-model";
import {QaError} from "./errors";
import {ReadLedger, refsInText} from "./read-ledger";
import profile from "./story-qa.profile";
import {storyQaPlugin, type QaToolState} from "./tools";

export type QaProgress = {kind: "tool"; tool: string; text: string} | {kind: "rejected"; text: string} | {kind: "answered"};

export interface AskInput {
    api: StoryApi;
    book?: string;
    /** 新对话的阅读位置；续问时不给（取记录里的）。 */
    at?: PositionInput;
    /** 新对话的做法；续问时不给。 */
    mode?: QaMode;
    question: string;
    config: QaConfig;
    /** 在这个对话里追问（qa.md 输出 26）。 */
    continueFrom?: string;
    signal?: AbortSignal;
    onProgress?: (event: QaProgress) => void;
    /** 透传给 nb-harness 的 `createHarness`（它的公开选项）；测试用脚本化模型。 */
    streamFn?: HarnessOptions["streamFn"];
}

/** 记录没保存的原因：书删了或换了代、格式不认识只读、对话被同时追问了，或写盘失败（附说明）。 */
export type NotSaved = {reason: "book_not_found" | "unsupported_format" | "conflict"} | {reason: "write_failed"; message: string};

/** 这一轮的结果（qa.md 输出 11）：对话的固定信息加这一轮；`id` 是对话 id，`turn` 从 1 数。`ask --json` 输出它。 */
export type QaTurnResult = Pick<QaConversation, "id" | "book" | "generation" | "at" | "mode"> & QaTurn & {turn: number};

export type QaOutcome = {result: QaTurnResult; conversation: QaConversation} & ({recordSaved: true} | {recordSaved: false; notSaved: NotSaved});

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

/** 一轮开始之前定下的东西：新对话现建，续问从记录读回。 */
interface Start {
    book: Awaited<ReturnType<StoryApi["openBook"]>>;
    features: BookFeatures;
    /** 续问时的上一份对话；新对话为 null。 */
    previous: QaConversation | null;
    id: string;
    at: Position;
    mode: QaMode;
    maxChapters: number | null;
    ledger: ReadLedger;
    /** 续问时读回的会话日志条目。 */
    entries: SessionEntry[] | null;
    firstMessage: string;
}

async function startNew(input: AskInput, started: number): Promise<Start> {
    const limits = qaLimits(input.config);
    const mode = input.mode ?? "graph";
    const book = await input.api.openBook(input.book);
    const info = await book.call("book.info", input.at === undefined ? {} : {at: input.at});
    if (!info.ok) throw new StoryError(info.error.code, info.error.message);
    const at: Position = info.value.at;
    const maxChapters = mode === "graph" ? limits.maxChapters : null;
    return {
        book,
        features: info.value.features,
        previous: null,
        id: newQaRecordId(new Date(started)),
        at,
        mode,
        maxChapters,
        ledger: new ReadLedger({paragraphs: book.meta.paragraphs, at, maxChapters, readAll: mode === "full"}),
        entries: null,
        firstMessage: mode === "full" ? await fullReadMessage(input, book, at, limits.fullReadMaxChars) : input.question,
    };
}

/** 续问：读记录与会话日志；读不成、对不上的在任何请求之前报 qa_not_continuable（F8）。 */
async function startContinued(input: AskInput, id: string): Promise<Start> {
    const book = await input.api.openBook(input.book);
    const records = new QaRecords(input.api.library, book.id);
    const previous = await records.get(id, book.generation);
    const notContinuable = (why: string) => new QaError("qa_not_continuable", `对话 ${id} 不能续问：${why}。请开新对话`);
    const log = await records.sessionLog(previous);
    if (!log.ok) throw notContinuable(log.problem);
    const entries: SessionEntry[] = [];
    for (const line of log.jsonl.split("\n")) {
        if (line === "") continue;
        const entry = parseEntryLine(line);
        if (entry === null) throw notContinuable("会话日志有读不成的行");
        entries.push(entry);
    }
    const info = await book.call("book.info", {at: previous.at});
    if (!info.ok) throw new StoryError(info.error.code, info.error.message);
    let ledger: ReadLedger;
    try {
        ledger = new ReadLedger({paragraphs: book.meta.paragraphs, at: previous.at, maxChapters: previous.maxChapters, readAll: previous.mode === "full", read: previous.read});
    } catch (error) {
        throw notContinuable(error instanceof Error ? error.message : String(error));
    }
    return {book, features: info.value.features, previous, id, at: previous.at, mode: previous.mode, maxChapters: previous.maxChapters, ledger, entries, firstMessage: input.question};
}

/** 停下时的文字回复：去掉首尾空白后为空就没有回复（输出 10）；正文里没核实的出处列出来（输出 24）。 */
function replyOf(result: TurnResult, ledger: ReadLedger): QaReply | null {
    const text = result.text.trim();
    if (text === "") return null;
    const unverifiedRefs = [...new Set(refsInText(text))].filter(ref => ledger.checkRef(ref) !== null);
    return {text, truncated: result.stopReason === "length", unverifiedRefs};
}

export async function askQuestion(input: AskInput): Promise<QaOutcome> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const model = configuredModel(input.config);
    const start = input.continueFrom === undefined ? await startNew(input, started) : await startContinued(input, input.continueFrom);
    const {book, at, mode, ledger, previous, id} = start;

    const state: QaToolState = {book, at, ledger, answer: null};
    // 作答被退回的次数：不只是我们的校验，OMP 的参数校验与“收尾要单独调用”的退回也算，所以按工具结束事件数。
    let rejections = 0;
    const registry = createToolRegistry();
    registerPlugin(registry, storyQaPlugin(state, start.features));
    const sessionLog = createMemorySessionLog({sessionId: id, ...(start.entries === null ? {} : {entries: start.entries})});

    let usage = emptyUsage();
    let outcome: Pick<QaTurn, "status" | "answer" | "reply" | "error"> = {status: "interrupted", answer: null, reply: null, error: null};
    const localFailure = (what: string, error: unknown): typeof outcome => ({status: "failed", answer: null, reply: null, error: {code: "model_failed", kind: "local", message: `${what}：${error instanceof Error ? error.message : String(error)}`}});
    let harness: Harness | null = null;
    try {
        harness = await createHarness({
            profile,
            ...(previous === null ? {initial: {title: book.meta.title, at: `${at.chapter}.${at.paragraph}`, mode, maxChapters: start.maxChapters, ...(start.features.ledger ? {} : {ledger: false})}} : {}),
            registry,
            model,
            sessionLog,
            ...thinkingOption(input.config),
            ...(input.streamFn === undefined ? {} : {streamFn: input.streamFn}),
        });
    } catch (error) {
        // 续问时恢复不了会话（Profile 版本或工具声明与快照不一致等）：还没发任何请求，不写记录。
        if (previous !== null && error instanceof HarnessError) throw new QaError("qa_not_continuable", `对话 ${id} 不能续问：${error.message}。请开新对话`);
        outcome = localFailure("本机错误", error);
    }
    if (harness !== null) {
        try {
            await runTurn(harness);
        } catch (error) {
            outcome = localFailure("本机错误", error);
        }
        try {
            await harness.close();
        } catch (error) {
            if (outcome.status !== "failed") outcome = localFailure("关闭会话失败", error);
        }
    }

    async function runTurn(harness: Harness): Promise<void> {
        harness.subscribe(event => {
            if (event.type === "tool_execution_start") input.onProgress?.({kind: "tool", tool: event.toolName, text: describeTool(event.toolName, (event.args ?? {}) as Record<string, unknown>)});
            if (event.type === "tool_execution_end" && event.toolName === "answer" && event.isError) {
                rejections += 1;
                const result = event.result as {content?: {type: string; text?: string}[]} | undefined;
                input.onProgress?.({kind: "rejected", text: result?.content?.map(block => block.text ?? "").join("") ?? ""});
            }
        });
        const result = await harness.turn(start.firstMessage, input.signal === undefined ? undefined : {signal: input.signal});
        usage = addUsage(usage, result.usage);
        if (result.stopReason === "finished" && state.answer !== null) {
            outcome = {status: "answered", answer: state.answer, reply: null, error: null};
            input.onProgress?.({kind: "answered"});
        } else if (result.stopReason === "error") {
            const error = result.error!;
            outcome = {status: "failed", answer: null, reply: null, error: {code: "model_failed", kind: error.kind, message: error.message}};
        } else if (result.stopReason === "stop" || result.stopReason === "length") {
            const reply = replyOf(result, ledger);
            outcome = reply === null
                ? {status: "failed", answer: null, reply: null, error: {code: "no_answer", message: "模型停下时既没有用 answer 交卷，也没有文字回复"}}
                : {status: "answered", answer: null, reply, error: null};
        }
        // 其余（aborted）：中断，保持初值。
    }

    const turn: QaTurn = {question: input.question, ...outcome, chaptersRead: ledger.chapters(), rejections, usage, ms: Date.now() - started, model: input.config.model.id, startedAt};
    const fixed = previous ?? {id, book: book.id, generation: book.generation, at, mode, maxChapters: start.maxChapters, startedAt};
    const conversation: Omit<QaConversation, "log"> = {
        id: fixed.id,
        book: fixed.book,
        generation: fixed.generation,
        at: fixed.at,
        mode: fixed.mode,
        maxChapters: fixed.maxChapters,
        read: ledger.snapshot(),
        turns: [...(previous?.turns ?? []), turn],
        startedAt: fixed.startedAt,
    };
    const result: QaTurnResult = {id, book: conversation.book, generation: conversation.generation, at, mode, turn: conversation.turns.length, ...turn};
    const entries = await sessionLog.read();
    let saved: Awaited<ReturnType<QaRecords["save"]>>;
    try {
        saved = await new QaRecords(input.api.library, book.id).save(conversation, entries.map(entry => `${JSON.stringify(entry)}\n`).join(""), {expectTurns: previous?.turns.length ?? 0});
    } catch (error) {
        return {result, conversation: {...conversation, log: null}, recordSaved: false, notSaved: {reason: "write_failed", message: error instanceof Error ? error.message : String(error)}};
    }
    return saved.saved ? {result, conversation: saved.conversation, recordSaved: true} : {result, conversation: {...conversation, log: null}, recordSaved: false, notSaved: {reason: saved.reason}};
}
