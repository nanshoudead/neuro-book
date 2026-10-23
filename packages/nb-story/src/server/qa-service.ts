/**
 * 独立服务里的网页问答与设置（docs/specs/story/qa.md 的“网页”）：`qa.*` 与 `config.*` 方法、本服务运行的问答表、
 * 运行中的推送，以及删除与停止时的收口。
 *
 * 一轮问答跑在服务进程里，不绑在请求上：`qa.start` 先准备（引擎的 `prepareQuestion`：读配置、书、位置、全读的
 * 原文、续问的记录与日志，开始前的错误都在这里作为请求的错误返回），成功后才登记运行、回复页面，之后在后台运行与
 * 保存。页面断开、刷新都不影响它。
 *
 * 接纳与收口（照 ingest-service.ts）：
 * - 一个对话同一时间只有一轮：准备中或运行中的对话再 `start` 得到 `qa_busy`。准备中的登记在第一个 await 之前。
 * - 删除对话、删除书（`exclusive`）、停止服务都先同步关上相应范围的门（之后的 `start` 得到 `qa_busy`），再取消并
 *   等待范围内正在准备、运行与保存的轮次，然后才删、才停。门关之前接纳、准备完才发现门关了的一轮直接放弃：不发
 *   请求、不写记录。
 * - 结束的运行留在表里，直到这个对话下一轮开始、对话或书被删、或服务停止：保存失败时它是这一轮唯一的来源。
 *
 * 推送：每个运行有自己的订阅者；引擎的回调同步地把日志条目与事件按发生顺序转成帧送出，`message_update` 合并成
 * 每个间隔最多一帧（其它帧之前先送出积着的那一帧，顺序不乱）。送帧抛错只退订那一个订阅者。
 */

import {randomUUID} from "node:crypto";

import {parseEntryLine, type SessionEntry} from "@notnotype/nb-session";

import {schemaProblems, type StoryApi} from "../core/api";
import {StoryError, type StoryErrorCode} from "../core/errors";
import {QaRecords, newQaRecordId, type QaConversation, type QaTurn} from "../core/qa-records";
import {QA_METHODS, type QaFrame, type QaMethod, type QaRunView, type ViewerParams, type ViewerResult} from "../contract/contract";
import {ABSENT_CONFIG, currentConfigDigest, defaultConfigPath, readQaConfigFile, saveQaConfig, type QaConfig} from "../qa/config";
import {prepareQuestion, withoutFullText, type AskInput, type PreparedQuestion, type QaOutcome} from "../qa/engine";
import {QaError, type QaErrorCode} from "../qa/errors";
import {probeModel} from "../qa/probe";
import type {QaAgentEvent} from "../qa/web-events";

export type QaServiceOutcome<M extends QaMethod> = {ok: true; value: ViewerResult<M>} | {ok: false; error: {code: StoryErrorCode | QaErrorCode; message: string}};

export interface QaSubscription {
    /** 为假时（没有运行，或运行已经结束）第一帧之后不会再有帧，调用方结束这条流。 */
    readonly live: boolean;
    close(): void;
}

export interface QaService {
    call<M extends QaMethod>(method: M, params: unknown): Promise<QaServiceOutcome<M>>;
    /** 订阅一个对话的运行：同步送出第一帧 `snapshot`，之后按顺序送，最后一帧是 `ended`。`send` 抛错即退订。 */
    subscribe(book: string, conversation: string, send: (frame: QaFrame) => void): QaSubscription;
    /** 删除书时用：关上这本书的门，取消并等待它的全部轮次，再运行 `task`，最后开门。 */
    exclusive<T>(book: string, task: () => Promise<T>): Promise<T>;
    /** 关门、取消全部轮次并等它们保存完；可以多次调用。 */
    close(): Promise<void>;
}

export interface QaServiceOptions {
    api: StoryApi;
    /** 配置文件；不给时用默认位置（与 `nbstory config` 相同）。 */
    configPath?: string;
    /** 密钥环境变量有没有值按它看；不给时是服务进程的环境。 */
    env?: NodeJS.ProcessEnv;
    /** 换掉发给模型的请求（nb-harness 的 `streamFn`，问答与测试连接都用）；脚本化模型的测试用它。 */
    streamFn?: AskInput["streamFn"];
    /** 同一条消息的 `message_update` 至少隔多久推一次，默认 100 毫秒。 */
    updateIntervalMs?: number;
    /** 测试连接最多等多久，默认 60 秒。 */
    probeTimeoutMs?: number;
}

/** 没有配置文件时设置页的起点：必填的几项空着，由表单提示补上。 */
const STARTER_CONFIG = {model: {baseUrl: "", id: "", apiKeyEnv: "OPENAI_API_KEY"}};

type RunSaved = QaRunView["saved"];

interface Run {
    readonly book: string;
    /** 这一轮固定在这本书的哪一代上：同 id 删掉又导入的书（例如命令行做的）是另一代，列表与读取不把它算进去。 */
    readonly generation: string;
    readonly fixed: Omit<QaRunView, "state" | "result" | "saved">;
    readonly controller: AbortController;
    state: "running" | "ended";
    result: QaTurn | null;
    saved: RunSaved;
    /** 这一轮写下的日志条目（全读的原文已去掉）。保存成功后清空：记录里有了。 */
    entries: SessionEntry[];
    /** 运行与保存都结束时 settle（不会 reject）。 */
    done: Promise<void>;
    readonly subscribers: Set<(frame: QaFrame) => void>;
    pendingUpdate: QaFrame | null;
    lastUpdate: number;
    timer: ReturnType<typeof setTimeout> | null;
}

const keyOf = (book: string, conversation: string): string => `${book}\u0000${conversation}`;
const busy = (message: string): QaError => new QaError("qa_busy", message);

/** 网页拿到的日志条目：只有全读对话第一轮的用户消息要去掉原文（engine.ts 的 `withoutFullText`）。 */
function projection(mode: string, turn: number, question: string): (entry: SessionEntry) => SessionEntry {
    return mode === "full" && turn === 1 ? entry => withoutFullText(entry, question) : entry => entry;
}

export function createQaService(options: QaServiceOptions): QaService {
    const {api} = options;
    const configPath = options.configPath ?? defaultConfigPath();
    const env = options.env ?? process.env;
    const updateInterval = options.updateIntervalMs ?? 100;
    const probeTimeout = options.probeTimeoutMs ?? 60_000;
    const streamFn = options.streamFn === undefined ? {} : {streamFn: options.streamFn};

    const runs = new Map<string, Run>();
    /** 已经接纳、还在准备的轮次，按“书/对话”；settle 时这一轮要么已登记进 `runs`，要么已放弃。 */
    const preparing = new Map<string, Promise<void>>();
    /** 关着的门：值是同时关着它的次数。 */
    const closedBooks = new Map<string, number>();
    const closedConversations = new Map<string, number>();
    let closing: Promise<void> | null = null;

    function shut(gates: Map<string, number>, key: string): () => void {
        gates.set(key, (gates.get(key) ?? 0) + 1);
        return () => {
            const left = gates.get(key)! - 1;
            if (left === 0) gates.delete(key);
            else gates.set(key, left);
        };
    }

    function admitting(book: string, key: string): boolean {
        return closing === null && !closedBooks.has(book) && !closedConversations.has(key);
    }

    function viewOf(run: Run): QaRunView {
        return {...run.fixed, state: run.state, result: run.result, saved: run.saved};
    }

    function broadcast(run: Run, frame: QaFrame): void {
        for (const send of run.subscribers) {
            try {
                send(frame);
            } catch (error) {
                run.subscribers.delete(send);
                console.warn({error, conversation: run.fixed.conversation}, "问答推送失败，已退订这个订阅者");
            }
        }
    }

    function flushUpdate(run: Run): void {
        if (run.timer !== null) {
            clearTimeout(run.timer);
            run.timer = null;
        }
        if (run.pendingUpdate === null) return;
        const frame = run.pendingUpdate;
        run.pendingUpdate = null;
        run.lastUpdate = Date.now();
        broadcast(run, frame);
    }

    function pushEvent(run: Run, event: QaAgentEvent): void {
        const frame: QaFrame = {type: "event", runId: run.fixed.runId, event};
        if (event.type !== "message_update") {
            flushUpdate(run);
            broadcast(run, frame);
            return;
        }
        // 流式的半截消息每个 token 一次：只留最新的一帧，按间隔送。
        run.pendingUpdate = frame;
        const wait = run.lastUpdate + updateInterval - Date.now();
        if (wait <= 0) flushUpdate(run);
        else run.timer ??= setTimeout(() => flushUpdate(run), wait);
    }

    function pushLog(run: Run, entries: readonly SessionEntry[]): void {
        const stripped = entries.map(projection(run.fixed.mode, run.fixed.turn, run.fixed.question));
        run.entries.push(...stripped);
        flushUpdate(run);
        broadcast(run, {type: "log", runId: run.fixed.runId, entries: stripped});
    }

    function end(run: Run, result: QaTurn | null, saved: NonNullable<RunSaved>): void {
        flushUpdate(run);
        run.state = "ended";
        run.result = result;
        run.saved = saved;
        if (saved.ok) run.entries = [];
        broadcast(run, {type: "ended", run: viewOf(run)});
        run.subscribers.clear();
    }

    function finish(run: Run, outcome: QaOutcome): void {
        const saved: NonNullable<RunSaved> = outcome.recordSaved
            ? {ok: true}
            : {ok: false, reason: outcome.notSaved.reason, ...(outcome.notSaved.reason === "write_failed" ? {message: outcome.notSaved.message} : {})};
        end(run, outcome.conversation.turns.at(-1)!, saved);
    }

    /** 取消并等待这些对话正在准备、运行与保存的轮次，再从表里去掉。调用方已经关上了它们的门。 */
    async function settle(keys: (key: string) => boolean): Promise<void> {
        for (const [key, run] of runs) if (keys(key) && run.state === "running") run.controller.abort();
        await Promise.all([...preparing].filter(([key]) => keys(key)).map(([, pending]) => pending));
        // 门关之前接纳、刚准备完的已经放弃；准备完时门还开着的，已经登记进表，这里一并取消。
        for (const [key, run] of runs) if (keys(key) && run.state === "running") run.controller.abort();
        await Promise.all([...runs].filter(([key]) => keys(key)).map(([, run]) => run.done));
        for (const key of [...runs.keys()]) if (keys(key)) runs.delete(key);
    }

    async function openRecords(book: string): Promise<{records: QaRecords; generation: string}> {
        const opened = await api.openBook(book);
        return {records: new QaRecords(api.library, opened.id), generation: opened.generation};
    }

    async function start(params: ViewerParams<"qa.start">): Promise<ViewerResult<"qa.start">> {
        const id = params.conversation ?? newQaRecordId();
        const key = keyOf(params.book, id);
        if (!admitting(params.book, key)) throw busy("这个对话或这本书正在删除，或服务正在停止");
        if (preparing.has(key) || runs.get(key)?.state === "running") throw busy(`对话 ${id} 已有一轮在运行`);

        const controller = new AbortController();
        let run: Run | null = null;
        /** 准备期间写下的日志条目（建 harness 时写的会话快照）：登记运行时交给它。 */
        const early: SessionEntry[] = [];
        const preparation = (async (): Promise<PreparedQuestion> => {
            const {config} = await readQaConfigFile(configPath);
            return prepareQuestion({
                api,
                book: params.book,
                question: params.question,
                config,
                ...(params.conversation === undefined ? {conversationId: id, mode: params.mode ?? "graph", ...(params.at === undefined ? {} : {at: params.at})} : {continueFrom: id}),
                signal: controller.signal,
                // 事件只在运行时有；日志条目在准备时就有一条（会话快照），先留着。
                onAgentEvent: event => {
                    if (run !== null) pushEvent(run, event);
                },
                onLogEntries: entries => {
                    if (run !== null) pushLog(run, entries);
                    else early.push(...entries);
                },
                ...streamFn,
            });
        })();
        let registered!: () => void;
        preparing.set(key, new Promise<void>(resolve => (registered = resolve)));
        let prepared: PreparedQuestion;
        try {
            prepared = await preparation;
        } catch (error) {
            preparing.delete(key);
            registered();
            throw error;
        }
        try {
            if (!admitting(params.book, key)) {
                await prepared.abandon().catch((error: unknown) => console.warn({error, conversation: id}, "放弃一轮时关闭会话失败"));
                throw busy("这个对话或这本书正在删除，或服务正在停止");
            }
            const current: Run = {
                book: params.book,
                generation: prepared.generation,
                fixed: {
                    runId: randomUUID(),
                    conversation: id,
                    turn: prepared.turn,
                    baseTurns: prepared.turn - 1,
                    logFrom: prepared.logFrom,
                    question: params.question,
                    at: prepared.at,
                    mode: prepared.mode,
                    startedAt: new Date().toISOString(),
                },
                controller,
                state: "running",
                result: null,
                saved: null,
                entries: early.map(projection(prepared.mode, prepared.turn, params.question)),
                done: Promise.resolve(),
                subscribers: new Set(),
                pendingUpdate: null,
                lastUpdate: 0,
                timer: null,
            };
            run = current;
            runs.set(key, current);
            current.done = prepared.run().then(
                outcome => finish(current, outcome),
                (error: unknown) => {
                    // 引擎把运行与保存的失败都收成结果；走到这里是没预料到的本机错误。
                    console.error({error, conversation: id}, "问答运行出错");
                    end(current, null, {ok: false, reason: "write_failed", message: "服务内部出错，详情见服务的日志"});
                },
            );
            return {conversation: id, runId: current.fixed.runId, turn: current.fixed.turn};
        } finally {
            preparing.delete(key);
            registered();
        }
    }

    async function stop(params: ViewerParams<"qa.stop">): Promise<ViewerResult<"qa.stop">> {
        // 只停已经开始运行的；准备中的一轮页面还拿不到，没有停的入口。停下的一轮按引擎规则记为中断。
        const run = runs.get(keyOf(params.book, params.conversation));
        if (run?.state === "running") run.controller.abort();
        return {};
    }

    async function remove(params: ViewerParams<"qa.remove">): Promise<ViewerResult<"qa.remove">> {
        const key = keyOf(params.book, params.id);
        const reopen = shut(closedConversations, key);
        try {
            const hadRun = runs.has(key) || preparing.has(key);
            await settle(candidate => candidate === key);
            const {records, generation} = await openRecords(params.book);
            try {
                await records.remove(params.id, generation);
            } catch (error) {
                // 只在内存里的首轮（还在跑或没保存）没有记录：删掉运行就是删掉了这个对话。
                if (!(hadRun && error instanceof StoryError && error.code === "qa_record_not_found")) throw error;
            }
            return {};
        } finally {
            reopen();
        }
    }

    /** 这本书当前这一代上的运行；别的一代的（同 id 删掉又导入之前的）不算。 */
    function runOf(book: string, conversation: string, generation: string): Run | undefined {
        const run = runs.get(keyOf(book, conversation));
        return run?.generation === generation ? run : undefined;
    }

    function listRow(run: Run): ViewerResult<"qa.list">["conversations"][number]["run"] {
        return {runId: run.fixed.runId, state: run.state, saved: run.saved === null ? null : run.saved.ok};
    }

    async function list(params: ViewerParams<"qa.list">): Promise<ViewerResult<"qa.list">> {
        const {records, generation} = await openRecords(params.book);
        const listed = await records.list(generation);
        const rows: ViewerResult<"qa.list">["conversations"] = listed.records.map(record => {
            const last = record.turns.at(-1)!;
            const run = runOf(params.book, record.id, generation);
            return {id: record.id, question: record.turns[0]!.question, turns: record.turns.length, status: last.status, at: record.at, mode: record.mode, startedAt: record.startedAt, updatedAt: last.startedAt, run: run === undefined ? null : listRow(run)};
        });
        const saved = new Set(listed.records.map(record => record.id));
        for (const run of runs.values()) {
            if (run.book !== params.book || run.generation !== generation || saved.has(run.fixed.conversation)) continue;
            const {conversation, question, at, mode, startedAt} = run.fixed;
            rows.push({id: conversation, question, turns: 0, status: run.result?.status ?? null, at, mode, startedAt, updatedAt: startedAt, run: listRow(run)});
        }
        rows.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        return {conversations: rows, broken: listed.broken};
    }

    function parseLog(jsonl: string, conversation: QaConversation): ViewerResult<"qa.get">["log"] {
        const project = projection(conversation.mode, 1, conversation.turns[0]!.question);
        const entries: SessionEntry[] = [];
        for (const line of jsonl.split("\n")) {
            if (line === "") continue;
            const entry = parseEntryLine(line);
            if (entry === null) return {ok: false, problem: "会话日志有读不成的行"};
            entries.push(project(entry));
        }
        return {ok: true, entries};
    }

    /**
     * 读记录要 await，期间这一轮可能刚保存完，读到的记录与运行状态不是同一时刻的：
     * - 运行已结束并保存，记录却是保存前的：再读一次记录；
     * - 记录已有这一轮，运行还没标结束：保存完到标结束只隔几个微任务，让出一次事件循环再读。让出之后仍是这样，就是
     *   命令行先保存了一轮（运行基于较早的记录），照实返回。
     * 页面拿到的记录与运行因此是同一时刻的（实现审查网页第 14 条）。
     */
    async function get(params: ViewerParams<"qa.get">): Promise<ViewerResult<"qa.get">> {
        for (let attempt = 0; ; attempt += 1) {
            const {result, generation} = await getOnce(params);
            const run = runOf(params.book, params.id, generation);
            const turns = result.record?.turns.length ?? 0;
            const stale = run?.state === "ended" && run.saved?.ok === true && turns < run.fixed.turn;
            const unfinished = run?.state === "running" && turns >= run.fixed.turn;
            if ((!stale && !unfinished) || attempt >= 2) return run === undefined ? result : {...result, run: viewOf(run)};
            if (unfinished) await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function getOnce(params: ViewerParams<"qa.get">): Promise<{result: ViewerResult<"qa.get">; generation: string}> {
        const {records, generation} = await openRecords(params.book);
        const run = runOf(params.book, params.id, generation);
        let conversation: QaConversation;
        let log: ViewerResult<"qa.get">["log"];
        try {
            const read = await records.getWithLog(params.id, generation);
            conversation = read.conversation;
            log = read.log.ok ? parseLog(read.log.jsonl, read.conversation) : {ok: false, problem: read.log.problem};
        } catch (error) {
            if (run === undefined || !(error instanceof StoryError && error.code === "qa_record_not_found")) throw error;
            const reason = run.state === "running" ? "第一轮还在运行" : "第一轮没有保存，不能续问";
            return {result: {record: null, log: {ok: true, entries: []}, continuable: {ok: false, reason}, run: viewOf(run)}, generation};
        }
        const continuable: ViewerResult<"qa.get">["continuable"] = conversation.log === null
            ? {ok: false, reason: "这是旧形状的记录，只能查看，不能续问"}
            : log.ok
              ? {ok: true}
              : {ok: false, reason: log.problem};
        const {id, at, mode, maxChapters, turns, startedAt} = conversation;
        return {result: {record: {id, at, mode, maxChapters, turns, startedAt}, log, continuable, run: run === undefined ? null : viewOf(run)}, generation};
    }

    function keysOf(config: unknown): Record<string, boolean> {
        const value = config as {model?: {apiKeyEnv?: unknown}; ingest?: {model?: {apiKeyEnv?: unknown}; recall?: {model?: {apiKeyEnv?: unknown}}}};
        const names = [value.model?.apiKeyEnv, value.ingest?.model?.apiKeyEnv, value.ingest?.recall?.model?.apiKeyEnv];
        // 用 fromEntries 建字典：变量名可以是 `__proto__`，按下标赋值会落到原型的 setter 上。
        return Object.fromEntries(names.filter((name): name is string => typeof name === "string" && name !== "").map(name => [name, (env[name] ?? "") !== ""]));
    }

    async function configGet(): Promise<ViewerResult<"config.get">> {
        let digest: string;
        try {
            digest = await currentConfigDigest(configPath);
        } catch (error) {
            // 读不出来（是目录、没权限）：给一个不会与任何摘要相等的值，写入时在锁里再读，照样报写不了。
            if (error instanceof QaError && error.code === "qa_unconfigured") return {state: "invalid", problem: error.message, digest: "unreadable", path: configPath, keys: {}};
            throw error;
        }
        if (digest === ABSENT_CONFIG) return {state: "absent", config: STARTER_CONFIG, digest, path: configPath, keys: keysOf(STARTER_CONFIG)};
        let read: {config: QaConfig; digest: string};
        try {
            read = await readQaConfigFile(configPath);
        } catch (error) {
            if (error instanceof QaError && error.code === "qa_unconfigured") return {state: "invalid", problem: error.message, digest, path: configPath, keys: {}};
            throw error;
        }
        return {state: "valid", config: read.config, digest: read.digest, path: configPath, keys: keysOf(read.config)};
    }

    async function configSet(params: ViewerParams<"config.set">): Promise<ViewerResult<"config.set">> {
        let saved: {config: QaConfig; digest: string};
        try {
            saved = await saveQaConfig(configPath, params.config, {expect: params.expect});
        } catch (error) {
            // 校验不过：说明里只有字段与规则，没有原值（qa 输出 19）。
            if (error instanceof QaError && error.code === "qa_unconfigured") throw new StoryError("invalid_params", error.message);
            throw error;
        }
        return {digest: saved.digest, path: configPath, keys: keysOf(saved.config)};
    }

    async function configTest(): Promise<ViewerResult<"config.test">> {
        const {config} = await readQaConfigFile(configPath);
        const fixed = {model: config.model.id, thinking: config.model.thinking ?? null};
        const started = Date.now();
        let result: Awaited<ReturnType<typeof probeModel>>;
        try {
            result = await probeModel(config, {signal: AbortSignal.timeout(probeTimeout), ...streamFn});
        } catch (error) {
            return {...fixed, ok: false, ms: Date.now() - started, error: {kind: "local", message: `本机错误：${error instanceof Error ? error.message : String(error)}`}};
        }
        if (result.ok) return {...fixed, ok: true, ms: result.ms, error: null};
        if (result.reason === "aborted") return {...fixed, ok: false, ms: result.ms, error: {kind: "timeout", message: `${probeTimeout / 1000} 秒内没有回应`}};
        if (result.reason === "not_finished") return {...fixed, ok: false, ms: result.ms, error: {kind: "local", message: `模型没有正常结束（${result.stopReason}）`}};
        return {...fixed, ok: false, ms: result.ms, error: {kind: result.error.kind, message: result.error.message}};
    }

    const handlers: {[M in QaMethod]: (params: ViewerParams<M>) => Promise<ViewerResult<M>>} = {
        "qa.list": list,
        "qa.get": get,
        "qa.start": start,
        "qa.stop": stop,
        "qa.remove": remove,
        "config.get": configGet,
        "config.set": configSet,
        "config.test": configTest,
    };

    return {
        async call(method, params) {
            try {
                const spec = QA_METHODS[method];
                const invalid = schemaProblems(spec.input, params);
                if (invalid) throw new StoryError("invalid_params", `参数不符合 ${method} 的 schema：${invalid}`);
                const value = await (handlers[method] as (params: unknown) => Promise<unknown>)(params);
                const broken = schemaProblems(spec.output, value);
                if (broken) throw new Error(`${method} 的结果不符合合同：${broken}`);
                return {ok: true, value: value as ViewerResult<typeof method>};
            } catch (error) {
                if (error instanceof StoryError || error instanceof QaError) return {ok: false, error: {code: error.code, message: error.message}};
                throw error;
            }
        },
        subscribe(book, conversation, send) {
            const run = runs.get(keyOf(book, conversation));
            const live = run?.state === "running";
            try {
                send({type: "snapshot", run: run === undefined ? null : viewOf(run), entries: run?.entries ?? []});
            } catch {
                return {live: false, close() {}};
            }
            if (!live) return {live: false, close() {}};
            run!.subscribers.add(send);
            return {live: true, close: () => void run!.subscribers.delete(send)};
        },
        async exclusive(book, task) {
            const reopen = shut(closedBooks, book);
            try {
                const prefix = keyOf(book, "");
                await settle(key => key.startsWith(prefix));
                return await task();
            } finally {
                reopen();
            }
        },
        close() {
            closing ??= settle(() => true);
            return closing;
        },
    };
}

export function isQaMethod(method: string): method is QaMethod {
    return Object.hasOwn(QA_METHODS, method);
}
