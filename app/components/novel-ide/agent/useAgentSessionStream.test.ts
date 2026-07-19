import {beforeEach, describe, expect, it, vi} from "vitest";
import {ref} from "vue";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import type {AgentSessionEventDto, AgentSessionEventsQueryDto, AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";

describe("useAgentSessionStream", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("首次订阅使用 recovery eventCursor", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 3));
        const cursors: AgentSessionEventsQueryDto[] = [];
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 3)),
                subscribeSessionEvents: vi.fn(async (_sessionId, cursor, onEvent, _signal, options) => {
                    cursors.push(cursor);
                    options?.onOpen?.();
                    await onEvent(connected(7));
                    await never();
                }),
            },
        });

        await stream.start(1);

        expect(cursors).toEqual([{eventEpoch: "epoch-1", after: 3}]);
        stream.stop();
    });

    it("连接 open 前 stop 会以 AbortError 结算 start", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 0)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, _onEvent, signal) => untilAbort(signal)),
            },
        });

        const starting = stream.start(1);
        await Promise.resolve();
        stream.stop();

        await expect(starting).rejects.toMatchObject({name: "AbortError"});
    });

    it("订阅在 open 前正常关闭会拒绝 start 并安排重连", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 0));
        const subscribeSessionEvents = vi.fn(async () => {});
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 0)),
                subscribeSessionEvents,
            },
        });

        await expect(stream.start(1)).rejects.toThrow("event stream closed before open");
        expect(session.connectionStatus.value).toBe("reconnecting");
        await vi.advanceTimersByTimeAsync(300);
        expect(subscribeSessionEvents).toHaveBeenCalledTimes(2);
        stream.stop();
    });

    it("多个 snapshot_required 事件共用一次 recovery", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery,
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, signal, options) => {
                    options?.onOpen?.();
                    if (!signal?.aborted && getSessionRecovery.mock.calls.length === 0) {
                        void onEvent(control(2, {type: "snapshot_required", reason: "trimmed"}));
                        void onEvent(control(3, {type: "snapshot_required", reason: "trimmed again"}));
                    }
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await Promise.resolve();
        expect(getSessionRecovery).toHaveBeenCalledTimes(1);

        resolveRecovery(recovery(1, 3));
        await vi.waitFor(() => expect(session.lastSeq.value).toBe(3));
        expect(session.needsRecovery.value).toBe(false);
        stream.stop();
    });

    it("活动连接应用 recovery 后从返回 cursor 重新订阅", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 5));
        const cursors: AgentSessionEventsQueryDto[] = [];
        let subscriptionCount = 0;
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 2)),
                subscribeSessionEvents: vi.fn(async (_sessionId, cursor, onEvent, signal, options) => {
                    subscriptionCount += 1;
                    cursors.push(cursor);
                    options?.onOpen?.();
                    await onEvent(connected(subscriptionCount === 1 ? 5 : 2));
                    if (subscriptionCount === 1) {
                        await onEvent(control(6, {type: "snapshot_required", reason: "replay expired"}));
                    }
                    await untilAbort(signal);
                }),
            },
        });

        await stream.start(1);
        await vi.waitFor(() => expect(cursors).toEqual([
            {eventEpoch: "epoch-1", after: 5},
            {eventEpoch: "epoch-1", after: 2},
        ]));
        expect(session.lastSeq.value).toBe(2);
        expect(session.connectionStatus.value).toBe("connected");
        stream.stop();
    });

    it("切换 session 后丢弃旧 recovery 响应", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applyRecovery(recovery(1, 1));
        let resolveOld!: (value: AgentSessionRecoveryDto) => void;
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSessionRecovery: vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
                    resolveOld = resolve;
                })),
                subscribeSessionEvents: vi.fn(async () => never()),
            },
        });

        const oldSync = stream.syncRecovery("manual_refresh");
        activeSessionId.value = 2;
        session.reset();
        session.applyRecovery(recovery(2, 9));
        resolveOld(recovery(1, 5));

        await expect(oldSync).resolves.toBe(false);
        expect(session.recoveryShell.value?.summary.sessionId).toBe(2);
        expect(session.lastSeq.value).toBe(9);
    });

    it("HTTP 与 SSE 同时请求 recovery 时复用同一 single-flight", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1, "rev-1"));
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery, subscribeSessionEvents: vi.fn(async () => never())},
        });

        session.applyLiveState({...liveState(1), activePathRevision: "rev-2"});
        const httpRecovery = stream.syncRecovery("active_path_changed");
        const sseRecovery = stream.syncRecovery("snapshot_required");

        expect(getSessionRecovery).toHaveBeenCalledTimes(1);
        resolveRecovery(recovery(1, 2, "rev-2"));
        await expect(httpRecovery).resolves.toBe(true);
        await expect(sseRecovery).resolves.toBe(true);
        expect(session.recoveryShell.value?.activePathRevision).toBe("rev-2");
    });

    it("invalid cursor 并发 recovery 只执行一次窗口重置副作用", async () => {
        const session = useAgentSession();
        session.applyRecovery({
            ...recovery(1, 1, "rev-1"),
            history: {entries: [], previousCursor: "invalid-cursor"},
        });
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });
        let resolveRecovery!: (value: AgentSessionRecoveryDto) => void;
        const getSessionRecovery = vi.fn(() => new Promise<AgentSessionRecoveryDto>((resolve) => {
            resolveRecovery = resolve;
        }));
        const applyRecoverySideEffects = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery, subscribeSessionEvents: vi.fn(async () => {})},
            applyRecoverySideEffects,
        });

        const historyRecovery = stream.syncRecovery("invalid_history_cursor");
        const sseRecovery = stream.syncRecovery("snapshot_required");
        expect(getSessionRecovery).toHaveBeenCalledTimes(1);
        resolveRecovery(recovery(1, 2, "rev-1"));

        await expect(historyRecovery).resolves.toBe(true);
        await expect(sseRecovery).resolves.toBe(true);
        expect(applyRecoverySideEffects).toHaveBeenCalledTimes(1);
        expect(applyRecoverySideEffects).toHaveBeenCalledWith(expect.anything(), {historyWindowReset: true});
    });

    it("invalid cursor recovery 失败时保留当前内容且不执行重置副作用", async () => {
        const session = useAgentSession();
        session.applyRecovery({
            ...recovery(1, 1, "rev-1"),
            history: {entries: [userEntry("existing", "当前内容")], previousCursor: "invalid-cursor"},
        });
        await session.loadPrevious(async () => {
            throw {statusCode: 400, data: {code: "INVALID_HISTORY_CURSOR", message: "cursor 已失效"}};
        });
        const applyRecoverySideEffects = vi.fn();
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => {
                    throw new Error("recovery failed");
                }),
                subscribeSessionEvents: vi.fn(async () => {}),
            },
            applyRecoverySideEffects,
        });

        await expect(stream.syncRecovery("invalid_history_cursor")).resolves.toBe(false);

        expect(session.durableEntries.value.map((entry) => entry.id)).toEqual(["existing"]);
        expect(session.historyError.value).toBe("cursor 已失效");
        expect(applyRecoverySideEffects).not.toHaveBeenCalled();
    });

    it("等待异步事件副作用完成后再应用下一帧", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 1));
        const appliedSeq: number[] = [];
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {
                getSessionRecovery: vi.fn(async () => recovery(1, 1)),
                subscribeSessionEvents: vi.fn(async (_sessionId, _cursor, onEvent, _signal, options) => {
                    options?.onOpen?.();
                    await onEvent(control(2, {type: "client_variable_patch_requested", request: {namespace: "client", path: "ide.selection", operations: []}}));
                    appliedSeq.push(session.lastSeq.value);
                    await onEvent(control(3, {type: "follow_up_queued", item: {id: "follow-1", kind: "followup", text: {preview: "继续", bytes: 6, omitted: false}, images: [], omittedImages: 0, createdAt: 1}}));
                    appliedSeq.push(session.lastSeq.value);
                    await never();
                }),
            },
            onEvent: async (event) => {
                if (event.kind === "session" && event.event.type === "client_variable_patch_requested") await blocked;
            },
        });

        const started = stream.start(1);
        await Promise.resolve();
        expect(appliedSeq).toEqual([]);
        release();
        await started;
        await vi.waitFor(() => expect(appliedSeq).toEqual([2, 3]));
        stream.stop();
    });

    it("连续重连失败后进入 disconnected，并允许手动重连", async () => {
        const session = useAgentSession();
        session.applyRecovery(recovery(1, 5));
        let fail = true;
        const subscribeSessionEvents = vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, _onEvent: (event: AgentSessionEventDto) => void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
            if (fail) throw new Error("network down");
            options?.onOpen?.();
            await never();
        });
        const stream = useAgentSessionStream({
            session,
            activeSessionId: ref(1),
            api: {getSessionRecovery: vi.fn(async () => recovery(1, 5)), subscribeSessionEvents},
        });

        await expect(stream.start(1)).rejects.toThrow("network down");
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(800);
        await vi.advanceTimersByTimeAsync(1500);
        expect(session.connectionStatus.value).toBe("disconnected");

        fail = false;
        await stream.reconnectNow();
        expect(session.connectionStatus.value).toBe("connecting");
        expect(subscribeSessionEvents).toHaveBeenCalledTimes(5);
        stream.stop();
    });
});

function recovery(sessionId: number, after: number, revision: string | null = null): AgentSessionRecoveryDto {
    return {
        kind: "recovery",
        eventCursor: {eventEpoch: "epoch-1", after},
        summary: {sessionId, profileKey: "leader.default", workspaceKey: "global", workspaceRoot: ".", status: "idle", updatedAt: 1, archived: false},
        activeLeafId: null,
        activePathRevision: revision,
        history: {entries: [], previousCursor: null},
        tree: [],
        linkedAgents: [],
        linkedByAgents: [],
        pendingUserInputs: [],
        steerQueue: {items: [], omittedItems: 0},
        followUpQueue: {status: "ready", items: [], omittedItems: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function userEntry(id: string, content: string): AgentChatEntryDto {
    const bytes = Buffer.byteLength(content, "utf8");
    return {
        id,
        timestamp: 1,
        type: "user",
        intent: "normal",
        blocks: [{type: "text", contentIndex: 0, content: {preview: content, bytes, omitted: false}}],
        omittedBlocks: 0,
        textSummary: {bytes, omitted: false},
    };
}

function liveState(sessionId: number) {
    const value = recovery(sessionId, 0);
    return {
        summary: value.summary,
        activeLeafId: value.activeLeafId,
        activePathRevision: value.activePathRevision,
        pendingUserInputs: value.pendingUserInputs,
        steerQueue: {count: value.steerQueue.items.length + value.steerQueue.omittedItems},
        followUpQueue: {status: value.followUpQueue.status, count: value.followUpQueue.items.length + value.followUpQueue.omittedItems},
        activeInvocation: value.activeInvocation,
        model: value.model,
        thinkingLevel: value.thinkingLevel,
        effectiveThinkingLevel: value.effectiveThinkingLevel,
        agentMode: value.agentMode,
    };
}

function connected(latestSeq: number): AgentSessionEventDto {
    return control(latestSeq, {type: "connected", eventEpoch: "epoch-1", latestSeq});
}

function control(seq: number, event: Extract<AgentSessionEventDto, {kind: "session"}>["event"]): AgentSessionEventDto {
    return {eventEpoch: "epoch-1", seq, sessionId: 1, kind: "session", event};
}

function never(): Promise<void> {
    return new Promise<void>(() => {});
}

function untilAbort(signal?: AbortSignal): Promise<void> {
    if (!signal) return never();
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), {once: true}));
}
