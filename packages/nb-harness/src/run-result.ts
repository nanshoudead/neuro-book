/**
 * 一次运行的结果：停止原因、错误归类与用量（docs/specs/agent/harness.md 输出 10 到 12）。
 */

import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import {Flag} from "@oh-my-pi/pi-ai/error/flags";
import type {SessionEntry} from "@notnotype/nb-session";

export type ErrorKind = "network" | "rate_limit" | "auth" | "quota" | "context_overflow" | "provider" | "local";

export interface RunError {
    readonly kind: ErrorKind;
    readonly status: number | null;
    readonly message: string;
}

export interface Usage {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    /** 单价未知时为 null。 */
    readonly cost: number | null;
    /** false：取消过，或察觉到 provider 层重试（被丢弃那次的用量拿不到），这份用量只是下界。 */
    readonly complete: boolean;
}

export type StopReason = "stop" | "finished" | "length" | "error" | "aborted";

export interface TurnResult {
    readonly stopReason: StopReason;
    readonly text: string;
    readonly finish: {readonly tool: string; readonly args: unknown} | null;
    readonly error: RunError | null;
    readonly usage: Usage;
    readonly entries: readonly SessionEntry[];
}

export type CompleteResult = Omit<TurnResult, "finish" | "entries">;

const NETWORK_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * provider 返回的错误按状态码与 OMP 的错误标记归类，优先级见输出 12；不看错误文字。
 * 余额与配额用尽在 OMP 里是 `UsageLimit` 标记（可能带 402 或 429），先于 429 归为 `quota`。
 * 没有状态码不等于网络故障（SSE 里的内容拦截、模型终态错误也没有状态码）：只有网关类状态码、超时标记，
 * 或没有状态码而带瞬时故障标记时才归 `network`，证据不够时归 `provider`。
 */
export function classifyProviderError(message: AssistantMessage): RunError {
    const status = typeof message.errorStatus === "number" ? message.errorStatus : null;
    const flags = typeof message.errorId === "number" ? message.errorId : 0;
    const has = (flag: number): boolean => (flags & flag) !== 0;
    const text = message.errorMessage ?? "模型请求失败";
    let kind: ErrorKind;
    if (has(Flag.AuthFailed) || status === 401 || status === 403) kind = "auth";
    else if (has(Flag.UsageLimit) || status === 402) kind = "quota";
    else if (status === 429) kind = "rate_limit";
    else if (has(Flag.ContextOverflow)) kind = "context_overflow";
    else if (has(Flag.ContentBlocked) || has(Flag.ProviderFinishError)) kind = "provider";
    else if ((status !== null && NETWORK_STATUSES.has(status)) || has(Flag.Timeout) || (status === null && has(Flag.Transient))) kind = "network";
    else kind = "provider";
    return {kind, status, message: text};
}

/** 累加一次运行的用量；`priceKnown` 为 false 时对外的 cost 为 null。 */
export class UsageMeter {
    #input = 0;
    #output = 0;
    #cacheRead = 0;
    #cacheWrite = 0;
    #cost = 0;
    #messages = 0;
    #requests = 0;
    #incomplete = false;

    constructor(private readonly priceKnown: boolean) {}

    /** 记一条助手消息的用量。 */
    add(message: AssistantMessage): void {
        this.#messages += 1;
        this.#input += message.usage.input;
        this.#output += message.usage.output;
        this.#cacheRead += message.usage.cacheRead;
        this.#cacheWrite += message.usage.cacheWrite;
        this.#cost += message.usage.cost.total;
    }

    /** 记一次实际发出的 HTTP 请求（经计数的 fetch）。 */
    request(): void {
        this.#requests += 1;
    }

    markIncomplete(): void {
        this.#incomplete = true;
    }

    snapshot(): Usage {
        // 发出的请求多于拿到的助手消息：中间有被 provider 丢弃的尝试，它的用量拿不到。
        const retried = this.#requests > this.#messages;
        return {
            input: this.#input,
            output: this.#output,
            cacheRead: this.#cacheRead,
            cacheWrite: this.#cacheWrite,
            cost: this.priceKnown ? this.#cost : null,
            complete: !this.#incomplete && !retried,
        };
    }
}

/** 一条消息的用量条目（写进会话日志）。 */
export function usageEntry(message: AssistantMessage, priceKnown: boolean) {
    return {
        kind: "usage" as const,
        input: message.usage.input,
        output: message.usage.output,
        cacheRead: message.usage.cacheRead,
        cacheWrite: message.usage.cacheWrite,
        cost: priceKnown ? message.usage.cost.total : null,
    };
}
