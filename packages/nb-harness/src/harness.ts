/**
 * 只经 Profile 运行的会话（docs/specs/agent/harness.md）。
 *
 * 一次 `turn()` 里几件事的先后（读懂这个文件要先知道它）：
 * 1. 占用会话（重叠的调用在任何副作用之前报 `session_busy`），解析密钥，把本轮用户消息写进日志，再交给
 *    `agent.prompt`；它的 `message_end` 按对象身份跳过，所以恰写一次。
 * 2. OMP 每次请求模型前先跑 `addBeforeModelCallHook` 的钩子：这里等写队列（只等已经排进去的写入，不等之后
 *    才发生的事件，否则环等），用已落盘的原样消息渲染 Profile，`setSystemPrompt` 并暂存渲染出的消息；随后
 *    OMP 同步系统提示词、调 `transformContext`，后者交回暂存的消息。送模型的内容以渲染为准，Agent 内部的
 *    调度历史不动。
 * 3. 模型消息与工具结果在 `message_end` 时按到达顺序排进写队列（原样消息，助手消息后跟一条用量）。
 * 4. 收尾工具：`beforeToolCall` 拦下混在一批里的；`afterToolCall` 只记“候选”并用 OMP 的 terminal reason
 *    停止循环。OMP 的顺序是 execute → afterToolCall → tool_execution_end → 工具结果的 message_end，所以
 *    候选要等它的工具结果写进日志才结算为 finished（输出 16），钩子里不能等这次写入。
 */

import {Agent, TERMINAL_TOOL_RESULT_ABORT_REASON, type AgentEvent, type AgentMessage, type StreamFn} from "@oh-my-pi/pi-agent-core";
import {streamSimple, type AssistantMessage, type Effort} from "@oh-my-pi/pi-ai";
import {ProfileError, toolSetItemId, type ProfileDefinition} from "@notnotype/nb-profile";
import type {JsonValue, SessionEntry, SessionEntryInput, SessionLog} from "@notnotype/nb-session";
import {renderContext} from "./context.js";
import {HarnessError} from "./errors.js";
import {MissingModelKeyError, type ResolvedModel} from "./model.js";
import {classifyProviderError, usageEntry, UsageMeter, type RunError, type StopReason, type TurnResult} from "./run-result.js";
import {bridgeTools} from "./tools/bridge.js";
import {declarationJson, resolveEffectiveTools, restoreEffectiveTools, type ToolPolicy} from "./tools/effective.js";
import type {RegisteredTool, ToolRegistry} from "./tools/registry.js";

export interface HarnessOptions {
    readonly profile: ProfileDefinition;
    /** 新会话必须给；恢复会话（日志以快照开头）不给。 */
    readonly initial?: unknown;
    readonly registry: ToolRegistry;
    readonly policy?: ToolPolicy;
    readonly model: ResolvedModel;
    readonly sessionLog: SessionLog;
    readonly thinkingLevel?: Effort;
    /** 替换模型输出（测试用）；provider 层仍走 OMP 的 `streamSimple`。 */
    readonly streamFn?: StreamFn;
}

export interface Harness {
    readonly sessionId: string;
    /** 这个会话的生效工具集（工具 id）。 */
    readonly tools: readonly string[];
    turn(input: string, options?: {readonly signal?: AbortSignal}): Promise<TurnResult>;
    subscribe(listener: (event: AgentEvent) => void): () => void;
    close(): Promise<void>;
}

/** 一次运行的可变状态；只在它自己的 `turn` 任务里读写。 */
interface Run {
    readonly meter: UsageMeter;
    cancelled: boolean;
    localError: RunError | null;
    finishCandidate: {readonly callId: string; readonly tool: string; readonly args: unknown} | null;
    finished: {readonly tool: string; readonly args: unknown} | null;
    task: Promise<TurnResult> | null;
}

function toJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function localError(message: string): RunError {
    return {kind: "local", status: null, message};
}

function wrapProfileError(error: unknown): never {
    if (error instanceof ProfileError) throw new HarnessError(error.code, error.message, {details: error.details});
    throw error;
}

export async function createHarness(options: HarnessOptions): Promise<Harness> {
    const {profile, registry, sessionLog, model} = options;
    const sessionId = sessionLog.sessionId;
    const existing = await sessionLog.read();

    let initial: unknown;
    let tools: RegisteredTool[];
    const history: AgentMessage[] = [];
    if (existing.length === 0) {
        if (options.initial === undefined) throw new HarnessError("invalid_initial", "新会话要给 initial");
        try {
            initial = profile.parseInitial(options.initial);
        } catch (error) {
            wrapProfileError(error);
        }
        tools = resolveEffectiveTools(profile, registry, options.policy);
        await sessionLog.append([
            {kind: "session_snapshot", profile: {key: profile.manifest.key, version: profile.manifest.version}, initial: toJson(initial), tools: tools.map((tool) => declarationJson(tool.declaration))},
        ]);
    } else {
        const [snapshot] = existing;
        if (snapshot?.kind !== "session_snapshot") throw new HarnessError("session_incompatible", "会话日志没有快照（旧格式），不能恢复");
        if (options.initial !== undefined) throw new HarnessError("invalid_initial", "恢复会话时不能再给 initial");
        if (snapshot.profile.key !== profile.manifest.key || snapshot.profile.version !== profile.manifest.version) {
            throw new HarnessError("session_incompatible", `快照的 Profile 是 ${snapshot.profile.key}@${snapshot.profile.version}，现在是 ${profile.manifest.key}@${profile.manifest.version}`, {
                snapshot: snapshot.profile,
                profile: {key: profile.manifest.key, version: profile.manifest.version},
            });
        }
        initial = snapshot.initial;
        tools = restoreEffectiveTools(snapshot.tools, profile, registry);
        for (const entry of existing) if (entry.kind === "agent_message") history.push(entry.message as unknown as AgentMessage);
    }

    const toolIds = new Set(tools.map((tool) => tool.declaration.id));
    const finishNames = new Map(tools.filter((tool) => tool.declaration.finish).map((tool) => [tool.declaration.name, tool.declaration.id] as const));
    const bridged = bridgeTools(tools, {sessionId, initial}, registry);

    // 写队列：条目按事件到达的顺序串行写入；`history` 只收已写进日志的原样消息，渲染就用它。
    let writes: Promise<void> = Promise.resolve();
    let writeError: unknown = null;
    const enqueue = (inputs: readonly SessionEntryInput[], onWritten?: (messages: readonly AgentMessage[]) => void, messages: readonly AgentMessage[] = []): Promise<void> => {
        const write = writes.then(async () => {
            if (writeError !== null) throw writeError;
            try {
                await sessionLog.append(inputs);
            } catch (error) {
                writeError = error;
                throw error;
            }
            history.push(...messages);
            onWritten?.(messages);
        });
        writes = write.catch(() => undefined);
        return write;
    };
    const drain = async (): Promise<void> => {
        await writes;
        if (writeError !== null) throw writeError;
    };

    let run: Run | null = null;
    let state: "idle" | "running" | "closing" | "closed" = "idle";
    let closing: Promise<void> | null = null;
    let renderedMessages: AgentMessage[] | null = null;
    const persisted = new WeakSet<object>();
    const listeners = new Set<(event: AgentEvent) => void>();

    const baseStream = options.streamFn ?? (streamSimple as StreamFn);
    const agent = new Agent({
        initialState: {model: model.model, systemPrompt: [], tools: bridged.agentTools, messages: [...history]},
        sessionId,
        getApiKey: () => model.apiKey(),
        // 计数的 fetch：一次运行里实际发出的 HTTP 请求多于助手消息时，中间有被 provider 丢弃的尝试（输出 11）。
        streamFn: (streamModel, context, streamOptions) => {
            const inner = streamOptions?.fetch ?? fetch;
            const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                run?.meter.request();
                return inner(input, init);
            }) as typeof fetch;
            return baseStream(streamModel, context, {...streamOptions, fetch: counted});
        },
        transformContext: async (messages) => renderedMessages ?? messages,
        beforeToolCall: ({assistantMessage, toolCall}) => {
            if (!finishNames.has(toolCall.name)) return undefined;
            const calls = assistantMessage.content.filter((block) => block.type === "toolCall").length;
            return calls > 1 ? {block: true, reason: "收尾工具要单独调用：这一批里还有别的工具调用，请等它们的结果回来后单独再交"} : undefined;
        },
        afterToolCall: ({toolCall, args, isError}) => {
            const tool = finishNames.get(toolCall.name);
            if (tool === undefined || isError || run === null) return undefined;
            run.finishCandidate = {callId: toolCall.id, tool, args};
            agent.abort(TERMINAL_TOOL_RESULT_ABORT_REASON);
            return undefined;
        },
    });
    if (options.thinkingLevel !== undefined) agent.setThinkingLevel(options.thinkingLevel);

    agent.addBeforeModelCallHook(async () => {
        // 取消可能发生在 prompt 刚开始、Agent 还没有可中止的请求时：在进模型之前补一次中止。
        if (run?.cancelled) agent.abort();
        try {
            await drain();
        } catch (error) {
            if (run !== null) run.localError = localError(`写会话日志失败：${String(error)}`);
            throw error;
        }
        try {
            const rendered = renderContext(profile, {initial, tools: toolIds, history, model: model.model});
            agent.setSystemPrompt(rendered.systemPrompt);
            renderedMessages = rendered.messages;
        } catch (error) {
            if (run !== null) run.localError = localError(`渲染 Profile 失败：${String(error)}`);
            throw error;
        }
    });

    const unsubscribeAgent = agent.subscribe((event) => {
        for (const listener of [...listeners]) listener(event);
        if (event.type !== "message_end") return;
        const message = event.message;
        if (persisted.has(message)) return;
        persisted.add(message);
        const current = run;
        const inputs: SessionEntryInput[] = [{kind: "agent_message", message: toJson(message)}];
        if (message.role === "assistant") {
            inputs.push(usageEntry(message as AssistantMessage, model.priceKnown));
            current?.meter.add(message as AssistantMessage);
        }
        const isFinishResult = message.role === "toolResult" && current?.finishCandidate?.callId === (message as {toolCallId?: string}).toolCallId;
        // 收尾的结束时刻是它的工具结果写进日志的这一刻：在写入链里结算，之前已取消的不算 finished（输出 16）。
        const settleFinish = (): void => {
            if (isFinishResult && current !== null && !current.cancelled && current.finishCandidate !== null) {
                current.finished = {tool: current.finishCandidate.tool, args: current.finishCandidate.args};
            }
        };
        enqueue(inputs, settleFinish, [message]).catch((error: unknown) => {
            if (current !== null && current.localError === null) current.localError = localError(`写会话日志失败：${String(error)}`);
        });
    });

    const lastAssistant = (fromIndex: number): AssistantMessage | null => {
        const messages = agent.state.messages;
        for (let index = messages.length - 1; index >= fromIndex; index -= 1) {
            const message = messages[index];
            if (message?.role === "assistant") return message as AssistantMessage;
        }
        return null;
    };

    const execute = async (current: Run, input: string): Promise<TurnResult> => {
        const startSeq = (await sessionLog.tail())?.seq ?? 0;
        const startIndex = agent.state.messages.length;
        const finishRun = async (stopReason: StopReason, error: RunError | null, text: string): Promise<TurnResult> => {
            if (stopReason === "error" || stopReason === "aborted") {
                await enqueue([{kind: "run_end", stopReason, error: error === null ? null : toJson(error)}]).catch(() => undefined);
            }
            await writes;
            if (current.cancelled) current.meter.markIncomplete();
            const entries: readonly SessionEntry[] = await sessionLog.read({sinceSeq: startSeq}).catch(() => []);
            return {stopReason, text, finish: stopReason === "finished" ? current.finished : null, error, usage: current.meter.snapshot(), entries};
        };

        try {
            model.apiKey();
        } catch (error) {
            if (error instanceof MissingModelKeyError) return finishRun("error", {kind: "auth", status: null, message: error.message}, "");
            throw error;
        }
        if (current.cancelled) return finishRun("aborted", null, "");

        const userMessage: AgentMessage = {role: "user", content: input, timestamp: Date.now()};
        persisted.add(userMessage);
        try {
            await enqueue([{kind: "agent_message", message: toJson(userMessage)}], undefined, [userMessage]);
        } catch (error) {
            return finishRun("error", localError(`写会话日志失败：${String(error)}`), "");
        }
        if (current.cancelled) return finishRun("aborted", null, "");

        await agent.prompt(userMessage);
        try {
            await drain();
        } catch (error) {
            if (current.localError === null) current.localError = localError(`写会话日志失败：${String(error)}`);
        }

        const last = lastAssistant(startIndex);
        const text = last === null ? "" : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        if (current.finished !== null) return finishRun("finished", null, text);
        if (current.localError !== null) return finishRun("error", current.localError, text);
        if (current.cancelled) return finishRun("aborted", null, text);
        if (last === null) return finishRun("error", localError("模型没有返回消息"), "");
        switch (last.stopReason) {
            case "stop":
            case "toolUse":
                return finishRun("stop", null, text);
            case "length":
                return finishRun("length", null, text);
            case "aborted":
                return finishRun("aborted", null, text);
            case "error":
                return finishRun("error", classifyProviderError(last), text);
        }
    };

    return {
        sessionId,
        tools: [...toolIds],
        turn(input, turnOptions) {
            if (state === "closing" || state === "closed") return Promise.reject(new HarnessError("session_closed", "会话已关闭"));
            if (state === "running") return Promise.reject(new HarnessError("session_busy", "这个会话正在运行"));
            state = "running";
            const current: Run = {meter: new UsageMeter(model.priceKnown), cancelled: false, localError: null, finishCandidate: null, finished: null, task: null};
            run = current;
            const signal = turnOptions?.signal;
            const cancel = (): void => {
                current.cancelled = true;
                agent.abort();
            };
            if (signal?.aborted) current.cancelled = true;
            else signal?.addEventListener("abort", cancel, {once: true});
            current.task = execute(current, input).finally(() => {
                signal?.removeEventListener("abort", cancel);
                renderedMessages = null;
                run = null;
                if (state === "running") state = "idle";
            });
            return current.task;
        },
        subscribe(listener) {
            if (state === "closing" || state === "closed") throw new HarnessError("session_closed", "会话已关闭");
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        close() {
            if (closing !== null) return closing;
            state = "closing";
            closing = (async () => {
                const current = run;
                if (current !== null) {
                    current.cancelled = true;
                    agent.abort();
                    await current.task?.catch(() => undefined);
                }
                await writes;
                for (const tool of tools) tool.handle.resolve()?.releaseSession?.(sessionId);
                bridged.dispose();
                unsubscribeAgent();
                listeners.clear();
                state = "closed";
            })();
            return closing;
        },
    };
}

/** Profile 声明的工具 id（不看登记表）；单次请求用它判断 Profile 是否带工具。 */
export function declaredToolIds(profile: ProfileDefinition): string[] {
    return profile.tools.map(toolSetItemId);
}
