import type {AgentRuntimeStreamEventDto, AgentSessionEventDto, AgentSessionEventsQueryDto, AgentSessionRecoveryDto} from "nbook/shared/dto/agent-session.dto";
import type {AgentRecoveryApplyResult} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {Ref} from "vue";
import {ref} from "vue";

export type AgentSessionStreamRecoveryReason =
    | "initial_load"
    | "seq_gap"
    | "snapshot_required"
    | "event_epoch_changed"
    | "active_path_changed"
    | "invalid_history_cursor"
    | "linked_agent_changed"
    | "manual_refresh"
    | "invoke_error_fallback";

type AgentSessionStreamStore = {
    eventEpoch: Ref<string | null>;
    lastSeq: Ref<number>;
    needsRecovery: Ref<boolean>;
    recoveryReasons: Ref<string[]>;
    applyConnectionStatus(status: "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected"): void;
    applyEvent(event: AgentSessionEventDto): void;
    applyRecovery(recovery: AgentSessionRecoveryDto): AgentRecoveryApplyResult;
    clearRecoveryRequest(): void;
};

type AgentSessionStreamApi = {
    getSessionRecovery(sessionId: number): Promise<AgentSessionRecoveryDto>;
    subscribeSessionEvents(
        sessionId: number,
        cursor: AgentSessionEventsQueryDto,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options?: {onOpen?: () => void},
    ): Promise<void>;
};

type AgentSessionStreamOptions = {
    session: AgentSessionStreamStore;
    api: AgentSessionStreamApi;
    activeSessionId: Ref<number | null>;
    applyRecoverySideEffects?: (recovery: AgentSessionRecoveryDto, result: AgentRecoveryApplyResult) => void | Promise<void>;
    onEvent?: (event: AgentSessionEventDto) => void | Promise<void>;
    onAgentCompleted?: (event: {
        sessionId: number;
        invocationId?: string;
        event: Extract<AgentRuntimeStreamEventDto, {type: "agent_end"}>;
    }) => void | Promise<void>;
    onError?: (error: unknown, fallback: string) => void;
};

type RuntimeI18n = {
    t: (key: string) => string;
};

const reconnectDelay = (attempt: number): number => {
    const delays = [300, 800, 1500, 3000, 5000];
    return delays[Math.min(attempt, delays.length - 1)] ?? 5000;
};
const DISCONNECTED_AFTER_ATTEMPTS = 3;

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

function isCompletedAgentEndEvent(event: AgentSessionEventDto): event is Extract<AgentSessionEventDto, {kind: "runtime"}> & {
    event: Extract<AgentRuntimeStreamEventDto, {type: "agent_end"}>;
} {
    return event.kind === "runtime" && event.event.type === "agent_end" && event.event.status === "completed";
}

/**
 * SSE stream helper 会被普通 Vitest 直接实例化；这里不能依赖 setup-only 的 useI18n。
 */
function translate(key: string, fallback: string): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * 管理 Agent session SSE 连接、重连和 recovery single-flight。
 */
export function useAgentSessionStream(options: AgentSessionStreamOptions) {
    const controller = ref<AbortController | null>(null);
    const sessionId = ref<number | null>(null);
    const reconnectAttempt = ref(0);
    const lastDisconnectReason = ref("");
    let readyPromise: Promise<void> | null = null;
    let resolveReady: (() => void) | null = null;
    let rejectReady: ((error: unknown) => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let recoveryPromise: {sessionId: number; promise: Promise<boolean>} | null = null;
    let recoveryGeneration = 0;
    let stopped = false;

    const clearReconnectTimer = (): void => {
        if (!reconnectTimer) {
            return;
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    };

    const createReadyPromise = (): void => {
        readyPromise = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        void readyPromise.catch(() => {});
    };

    const scheduleReconnect = (targetSessionId: number, reason: string): void => {
        if (targetSessionId !== options.activeSessionId.value || stopped) {
            return;
        }
        lastDisconnectReason.value = reason;
        options.session.applyConnectionStatus(reconnectAttempt.value >= DISCONNECTED_AFTER_ATTEMPTS ? "disconnected" : "reconnecting");
        const delay = reconnectDelay(reconnectAttempt.value);
        reconnectAttempt.value += 1;
        reconnectTimer = setTimeout(() => {
            void start(targetSessionId).catch(() => {});
        }, delay);
    };

    const syncRecovery = async (reason: AgentSessionStreamRecoveryReason): Promise<boolean> => {
        const targetSessionId = options.activeSessionId.value;
        if (!targetSessionId) {
            return false;
        }
        if (recoveryPromise?.sessionId === targetSessionId) {
            return recoveryPromise.promise;
        }
        const generation = recoveryGeneration;
        if (reason !== "manual_refresh" && reason !== "invoke_error_fallback") {
            options.session.applyConnectionStatus("recovering");
        }
        const request = {sessionId: targetSessionId, promise: Promise.resolve(false)};
        const promise = (async () => {
            try {
                const recovery = await options.api.getSessionRecovery(targetSessionId);
                if (generation !== recoveryGeneration || targetSessionId !== options.activeSessionId.value) {
                    return false;
                }
                const applyResult = options.session.applyRecovery(recovery);
                options.session.clearRecoveryRequest();
                await options.applyRecoverySideEffects?.(recovery, applyResult);
                return true;
            } catch (error) {
                options.onError?.(error, translate("agent.chatSurface.syncSessionFailed", "同步 Agent session 失败"));
                return false;
            } finally {
                if (recoveryPromise === request) {
                    recoveryPromise = null;
                }
            }
        })();
        request.promise = promise;
        recoveryPromise = request;
        return promise;
    };

    const handleEvent = async (targetSessionId: number, event: AgentSessionEventDto): Promise<void> => {
        if (targetSessionId !== options.activeSessionId.value) {
            return;
        }
        const previousSeq = options.session.lastSeq.value;
        await options.onEvent?.(event);
        options.session.applyEvent(event);
        const eventApplied = event.seq > previousSeq && options.session.lastSeq.value >= event.seq;
        let recoveryReady = true;
        if (options.session.needsRecovery.value) {
            const reasons = options.session.recoveryReasons.value;
            let reason: AgentSessionStreamRecoveryReason = "seq_gap";
            if (reasons.includes("event_epoch_changed")) {
                reason = "event_epoch_changed";
            } else if (reasons.includes("snapshot_required")) {
                reason = "snapshot_required";
            } else if (reasons.includes("active_path_changed")) {
                reason = "active_path_changed";
            } else if (reasons.includes("invalid_history_cursor")) {
                reason = "invalid_history_cursor";
            } else if (reasons.includes("linked_agent_changed")) {
                reason = "linked_agent_changed";
            }
            recoveryReady = await syncRecovery(reason);
        }
        if (eventApplied && recoveryReady && isCompletedAgentEndEvent(event)) {
            await options.onAgentCompleted?.({
                sessionId: targetSessionId,
                invocationId: event.invocationId,
                event: event.event,
            });
        }
    };

    const start = async (targetSessionId: number): Promise<void> => {
        if (controller.value && sessionId.value === targetSessionId) {
            await readyPromise;
            return;
        }
        clearReconnectTimer();
        controller.value?.abort();
        const nextController = new AbortController();
        controller.value = nextController;
        sessionId.value = targetSessionId;
        stopped = false;
        createReadyPromise();
        options.session.applyConnectionStatus(reconnectAttempt.value > 0 ? "reconnecting" : "connecting");

        void (async () => {
            try {
                await options.api.subscribeSessionEvents(targetSessionId, {
                    eventEpoch: options.session.eventEpoch.value ?? undefined,
                    after: options.session.lastSeq.value,
                }, async (event) => {
                    await handleEvent(targetSessionId, event);
                }, nextController.signal, {
                    onOpen: () => {
                        reconnectAttempt.value = 0;
                        resolveReady?.();
                    },
                });
                scheduleReconnect(targetSessionId, "event stream closed");
            } catch (error) {
                rejectReady?.(error);
                if (targetSessionId === options.activeSessionId.value && !isAbortError(error) && !stopped) {
                    scheduleReconnect(targetSessionId, error instanceof Error ? error.message : String(error));
                }
            } finally {
                if (controller.value === nextController) {
                    controller.value = null;
                    sessionId.value = null;
                    readyPromise = null;
                    resolveReady = null;
                    rejectReady = null;
                }
            }
        })();
        await readyPromise;
    };

    const ensure = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        await start(options.activeSessionId.value);
    };

    const reconnectNow = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        clearReconnectTimer();
        reconnectAttempt.value = 0;
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        readyPromise = null;
        await start(options.activeSessionId.value);
    };

    const stop = (): void => {
        stopped = true;
        clearReconnectTimer();
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        readyPromise = null;
        recoveryGeneration += 1;
        recoveryPromise = null;
        options.session.applyConnectionStatus("idle");
    };

    return {
        ensure,
        lastDisconnectReason,
        reconnectNow,
        reconnectAttempt,
        start,
        stop,
        syncRecovery,
    };
}
