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
 *
 * 第 1 步与建 harness 在 `prepareQuestion` 里做完，开始前的错误都从它抛出；`run` 做其余几步。
 */

import {createHarness, createToolRegistry, HarnessError, registerPlugin, type Harness, type HarnessOptions, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog, parseEntryLine, type JsonValue, type SessionEntry, type SessionLog} from "@notnotype/nb-session";

import {refsInText} from "../contract/refs";
import type {StoryApi} from "../core/api";
import type {BookFeatures, Position} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";
import {newQaRecordId, QaRecords, type QaConversation, type QaMode, type QaReply, type QaTurn, type QaUsage} from "../core/qa-records";
import {qaLimits, type QaConfig} from "./config";
import {configuredModel, thinkingOption} from "./harness-model";
import {QaError} from "./errors";
import {ReadLedger} from "./read-ledger";
import profile from "./story-qa.profile";
import {storyQaPlugin, type QaToolState} from "./tools";
import {webEventOf, type QaAgentEvent} from "./web-events";

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
    /**
     * 新对话的 id：网页问答由服务端先定下（`newQaRecordId()`），这一轮开始前就能告诉页面。不给时照旧生成；续问时忽略。
     */
    conversationId?: string;
    /** 运行中的事件，只留网页用得到的部分（见 `web-events.ts`）。回调抛错不影响这一轮。 */
    onAgentEvent?: (event: QaAgentEvent) => void;
    /** 会话日志新写入的条目（带 seq，按写入顺序）。续问时读回的旧条目不再发。回调抛错不影响这一轮。 */
    onLogEntries?: (entries: readonly SessionEntry[]) => void;
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
    return `${FULL_READ_HEAD}\n${paragraphs.map(item => `${item.chapter}.${item.paragraph} ${item.text}`).join("\n")}${FULL_READ_QUESTION}${input.question}`;
}

const FULL_READ_HEAD = "以下是阅读位置以前的全部原文：";
/** 原文每段一行，段里没有空行，所以第一个空行加“问题：”就是原文与问题的分界。 */
const FULL_READ_QUESTION = "\n\n问题：";

/**
 * 全读对话的第一条用户消息换成问题加一句说明，不带原文：网页拿到的日志（`qa.get` 与运行中推送的条目）都经过它，
 * 免得每次打开对话都传一整本书（qa.md 的“网页”）。存盘的日志不变，续问照旧交回模型原文。
 */
export function withoutFullText(entry: SessionEntry): SessionEntry {
    if (entry.kind !== "agent_message" || typeof entry.message !== "object" || entry.message === null || Array.isArray(entry.message)) return entry;
    const message = entry.message as {readonly [key: string]: JsonValue};
    if (message.role !== "user") return entry;
    const content = message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(block => (typeof block === "object" && block !== null && !Array.isArray(block) && typeof block.text === "string" ? block.text : "")).join("") : "";
    if (!text.startsWith(FULL_READ_HEAD)) return entry;
    const split = text.indexOf(FULL_READ_QUESTION);
    if (split < 0) return entry;
    const question = text.slice(split + FULL_READ_QUESTION.length);
    const paragraphs = text.slice(FULL_READ_HEAD.length, split).split("\n").filter(line => line !== "").length;
    return {...entry, message: {...message, content: [{type: "text", text: `${question}\n\n（已附阅读位置以前的全部原文，共 ${paragraphs} 段，这里不显示）`}]}};
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
        id: input.conversationId ?? newQaRecordId(new Date(started)),
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
    const {conversation: previous, log} = await records.getWithLog(id, book.generation);
    const notContinuable = (why: string) => new QaError("qa_not_continuable", `对话 ${id} 不能续问：${why}。请开新对话`);
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

/**
 * 观察者的回调与运行隔离：抛错只写一条诊断。日志的 `append` 一旦失败，harness 会把会话判坏、这一轮以本机错误结束，
 * 而条目其实已经写进去了；网页断开等观察者一侧的错误不能改变这一轮的结果与保存。
 */
function notify(call: () => void): void {
    try {
        call();
    } catch (error) {
        console.error(`nbstory：问答的观察者出错，已忽略：${error instanceof Error ? error.message : String(error)}`);
    }
}

/** 包一层会话日志：底层 `append` 返回已编号的条目之后通知观察者。 */
function observed(log: SessionLog, onEntries: AskInput["onLogEntries"]): SessionLog {
    if (onEntries === undefined) return log;
    return {
        ...log,
        async append(inputs) {
            const entries = await log.append(inputs);
            notify(() => onEntries(entries));
            return entries;
        },
    };
}

/** 停下时的文字回复：去掉首尾空白后为空就没有回复（输出 10）；正文里没核实的出处列出来（输出 24）。 */
function replyOf(result: TurnResult, ledger: ReadLedger): QaReply | null {
    const text = result.text.trim();
    if (text === "") return null;
    const unverifiedRefs = [...new Set(refsInText(text))].filter(ref => ledger.checkRef(ref) !== null);
    return {text, truncated: result.stopReason === "length", unverifiedRefs};
}

/** 问一轮：先准备（会抛出开始前的错误），再运行。`nbstory ask` 用它；网页问答分两步调（见 `prepareQuestion`）。 */
export async function askQuestion(input: AskInput): Promise<QaOutcome> {
    return (await prepareQuestion(input)).run();
}

/**
 * 准备好、还没开始的一轮。开始前的错误（查询失败、全读超上限、续问不了）都在 `prepareQuestion` 里抛出，不会推迟到
 * `run`：网页问答在准备成功后才登记运行、回复页面，失败的直接作为请求的错误返回，运行表里不会留下没人收口的一项。
 * 准备好之后必须二选一：`run()` 一次，或者不运行了就 `abandon()` 关掉已建的 harness。
 */
export interface PreparedQuestion {
    /** 对话 id：新对话是 `conversationId` 或新生成的，续问是原对话的。 */
    readonly id: string;
    /** 这一轮是对话的第几轮（从 1 数）。 */
    readonly turn: number;
    /** 这一轮在会话日志里从哪一条开始（同记录的 `logFrom`）。 */
    readonly logFrom: number;
    /** 对话的阅读位置与做法（续问时是记录里的）。 */
    readonly at: Position;
    readonly mode: QaMode;
    run(): Promise<QaOutcome>;
    abandon(): Promise<void>;
}

export async function prepareQuestion(input: AskInput): Promise<PreparedQuestion> {
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
    // 这一轮在日志里从哪一条开始（记进记录，网页按它对轮次）。
    const logFrom = (start.entries?.length ?? 0) + 1;
    const sessionLog = observed(createMemorySessionLog({sessionId: id, ...(start.entries === null ? {} : {entries: start.entries})}), input.onLogEntries);

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

    async function runTurn(harness: Harness): Promise<void> {
        harness.subscribe(event => {
            const web = input.onAgentEvent === undefined ? null : webEventOf(event);
            if (web !== null) notify(() => input.onAgentEvent!(web));
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

    async function finish(): Promise<QaOutcome> {
        const turn: QaTurn = {question: input.question, ...outcome, chaptersRead: ledger.chapters(), rejections, usage, ms: Date.now() - started, model: input.config.model.id, startedAt, logFrom};
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

    const created = harness;
    let settled = false;
    const claim = (what: string) => {
        if (settled) throw new Error(`这一轮已经${what}过了`);
        settled = true;
    };
    return {
        id,
        turn: (previous?.turns.length ?? 0) + 1,
        logFrom,
        at,
        mode,
        async run() {
            claim("运行或放弃");
            if (created !== null) {
                try {
                    await runTurn(created);
                } catch (error) {
                    outcome = localFailure("本机错误", error);
                }
                try {
                    await created.close();
                } catch (error) {
                    if (outcome.status !== "failed") outcome = localFailure("关闭会话失败", error);
                }
            }
            return finish();
        },
        async abandon() {
            claim("运行或放弃");
            await created?.close();
        },
    };
}
