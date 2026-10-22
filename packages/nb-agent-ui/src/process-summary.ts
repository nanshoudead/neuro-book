import type {ViewText} from "./types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";

/** 摘要行的文案：概括各段与危险色提醒，调用方翻译后用“ · ”连接。 */
export type ProcessDescription = {
    parts: ViewText[];
    alert: ViewText | null;
};

/** 读和改写成一句话；两者都有时共用“文件”，读起来像人说的而不是统计表。 */
function filesPhrase(read: number, changed: number): ViewText | null {
    if (read > 0 && changed > 0) {
        return {key: "process.files.readChanged", params: {read, changed}};
    }
    if (read > 0) {
        return {key: "process.files.read", params: {count: read}};
    }
    if (changed > 0) {
        return {key: "process.files.changed", params: {count: changed}};
    }
    return null;
}

function failedAlert(failed: number): ViewText | null {
    return failed > 0 ? {key: "process.failed", params: {count: failed}} : null;
}

/** 一条思维链：思考、读改了哪些文件、其余操作的次数；什么都没有时退回“过程”。 */
export function describeChain(summary: ChainSummary): ProcessDescription {
    const parts: ViewText[] = [];
    if (summary.thinking) {
        parts.push({key: "process.thinking"});
    }
    const files = filesPhrase(summary.filesRead, summary.filesChanged);
    if (files !== null) {
        parts.push(files);
    }
    if (summary.others > 0) {
        parts.push({key: files === null ? "process.actions" : "process.others", params: {count: summary.others}});
    }
    if (parts.length === 0) {
        parts.push({key: "process.fallback"});
    }
    return {parts, alert: failedAlert(summary.failed)};
}

/** 整轮过程：以“过程”开头，写总操作次数与读改文件数，让人判断值不值得展开。 */
export function describeTurn(metrics: TurnMetrics): ProcessDescription {
    const parts: ViewText[] = [{key: "process.fallback"}];
    if (metrics.steps > 0) {
        parts.push({key: "process.actions", params: {count: metrics.steps}});
    }
    const files = filesPhrase(metrics.filesRead, metrics.filesChanged);
    if (files !== null) {
        parts.push(files);
    }
    return {parts, alert: failedAlert(metrics.failed)};
}

// ─── 轮末用量 ───────────────────────────────────────────────────────────

/** 轮末用量行：每项一个图标加文字，另有悬停时看的完整构成。 */
export type UsageDescription = {
    parts: Array<{icon: string; text: ViewText}>;
    /** 输入、输出与缓存读写的完整数字；没有用量数据时为 null。 */
    detail: ViewText | null;
};

function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTokens(value: number): string {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** 不到一分钱的费用多留两位，免得都显示成 0.00；免费就是 0。 */
export function formatCost(value: number, currency: "USD" | "CNY"): string {
    const symbol = currency === "CNY" ? "¥" : "$";
    if (value === 0) return `${symbol}0`;
    return `${symbol}${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

/**
 * 一轮的用时、tokens、输入输出、缓存读取与费用。缺哪项省哪项，缓存读取为 0 时省略；`showDuration` 为假时不写用时
 * （例如这一轮还没有 Agent 一侧的内容）。
 */
export function describeUsage(metrics: TurnMetrics, currency: "USD" | "CNY", options: {showDuration: boolean}): UsageDescription {
    const {durationMs, tokens, cost, usage} = metrics;
    const parts: UsageDescription["parts"] = [];
    if (durationMs !== null && options.showDuration) {
        parts.push({icon: "i-lucide-timer", text: formatDuration(durationMs)});
    }
    if (tokens !== null) {
        parts.push({icon: "i-lucide-zap", text: {key: "metrics.tokens", params: {value: formatTokens(tokens)}}});
    }
    if (usage !== null) {
        parts.push({icon: "i-lucide-arrow-down", text: formatTokens(usage.input)});
        parts.push({icon: "i-lucide-arrow-up", text: formatTokens(usage.output)});
        if (usage.cacheRead > 0) {
            parts.push({icon: "i-lucide-database-zap", text: formatTokens(usage.cacheRead)});
        }
    }
    if (cost !== null) {
        parts.push({icon: "i-lucide-circle-dollar-sign", text: formatCost(cost, currency)});
    }
    const detail: ViewText | null = usage === null ? null : {key: "usage.detail", params: {
        input: formatTokens(usage.input),
        output: formatTokens(usage.output),
        cacheRead: formatTokens(usage.cacheRead),
        cacheWrite: formatTokens(usage.cacheWrite),
    }};
    return {parts, detail};
}
