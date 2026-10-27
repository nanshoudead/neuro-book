/**
 * 问答页的会话用量（docs/specs/story/viewer.md 输出 52）：从对话里的助手消息算出状态条与上下文检查器要的数。
 * 一条带用量的助手消息就是一次模型请求（一轮里读了几章、查了几次就有几条）。纯函数，页面只做接线。
 */

import type {MessageView} from "@notnotype/nb-agent-ui";

export interface RequestUsage {
    /** 第几次请求（从 1 起，按消息先后）。 */
    readonly index: number;
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    /** 这次请求的提示词大小：输入加缓存读写（同 OMP 的 `calculatePromptTokens`）。 */
    readonly prompt: number;
    /** 提示词里缓存命中的比例（0 到 1）；提示词为 0 时 null。 */
    readonly hitRate: number | null;
    /** 单价未知时 null。 */
    readonly cost: number | null;
}

export interface SessionUsage {
    readonly requests: readonly RequestUsage[];
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    /** 累积的缓存命中率：缓存读 ÷ 全部提示词；没有提示词时 null。 */
    readonly hitRate: number | null;
    /** 已知单价的请求的费用合计；一个单价都不知道时 null（界面不显示金额）。 */
    readonly cost: number | null;
    /** 每一次请求都知道单价；为 false 时 `cost` 只是已知部分的小计。 */
    readonly costComplete: boolean;
}

export function requestsOf(messages: readonly MessageView[]): RequestUsage[] {
    const requests: RequestUsage[] = [];
    for (const message of messages) {
        if (message.kind !== "assistant" || message.usage === undefined) continue;
        const {input, output, cacheRead, cacheWrite, cost} = message.usage;
        const prompt = input + cacheRead + cacheWrite;
        requests.push({index: requests.length + 1, input, output, cacheRead, cacheWrite, prompt, hitRate: prompt > 0 ? cacheRead / prompt : null, cost});
    }
    return requests;
}

export function sessionUsage(messages: readonly MessageView[]): SessionUsage {
    const requests = requestsOf(messages);
    const sum = (pick: (request: RequestUsage) => number) => requests.reduce((total, request) => total + pick(request), 0);
    const prompt = sum(request => request.prompt);
    const known = requests.filter(request => request.cost !== null);
    return {
        requests,
        input: sum(request => request.input),
        output: sum(request => request.output),
        cacheRead: sum(request => request.cacheRead),
        cacheWrite: sum(request => request.cacheWrite),
        hitRate: prompt > 0 ? sum(request => request.cacheRead) / prompt : null,
        cost: known.length === 0 ? null : known.reduce((total, request) => total + request.cost!, 0),
        costComplete: known.length === requests.length,
    };
}

/** 一次请求的提示词里三段的占比（0 到 100，合计 100）：缓存读、缓存写、新输入。提示词为 0 时全 0。 */
export function cacheBar(request: RequestUsage): {read: number; write: number; fresh: number} {
    if (request.prompt <= 0) return {read: 0, write: 0, fresh: 0};
    const read = (request.cacheRead / request.prompt) * 100;
    const write = (request.cacheWrite / request.prompt) * 100;
    return {read, write, fresh: 100 - read - write};
}

/** 上下文占用百分比；窗口未知或为 0 时 null。 */
export function contextPercent(tokens: number, limit: number | null): number | null {
    return limit === null || limit <= 0 ? null : (tokens / limit) * 100;
}

/** 金额的短写，保留两位小数；小于 0.01 时写 `< 0.01`，避免显示成 0。 */
export function formatCost(value: number, currency: string): string {
    const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : `${currency} `;
    return value > 0 && value < 0.01 ? `${symbol}< 0.01` : `${symbol}${value.toFixed(2)}`;
}

export function formatPercent(value: number): string {
    return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)}%`;
}
