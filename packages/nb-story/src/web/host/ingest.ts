/**
 * 网页上抽取的显示规则（docs/specs/story/viewer.md 输出 36 到 40）：状态徽标、停下的原因与下一步、用时、费用与
 * token 的写法。书架、导入页、进度页与书的顶栏共用。
 */

import type {IngestStatusView} from "../../contract/contract";

type Step = NonNullable<NonNullable<IngestStatusView["current"]>["step"]>;

/** 进度页的四步；整理在第 5 的倍数章与末章另有一步。 */
export const STEPS: readonly Step[] = ["beats", "draft", "review", "repair"];
export const STEP_LABELS: Record<Step, string> = {beats: "时间点与段落块", draft: "其余记录", review: "核对补漏", repair: "修复", consolidation: "整理"};

export type BadgeTone = "accent" | "neutral" | "danger";

/** 状态徽标；抽完的不带徽标（null）。 */
export function ingestBadge(status: Pick<IngestStatusView, "state" | "runner" | "stopReason">): {text: string; tone: BadgeTone; dot: boolean} | null {
    if (status.state === "done") return null;
    if (status.state === "running") return {text: status.runner === "cli" ? "命令行抽取中" : "抽取中", tone: "accent", dot: true};
    if (status.stopReason?.kind === "failed") return {text: "失败停下", tone: "danger", dot: false};
    return {text: "已停下", tone: "neutral", dot: false};
}

const KIND_TEXT: Record<string, string> = {
    auth: "认证失败",
    quota: "额度用尽",
    rate_limit: "被限流",
    network: "网络或服务出错",
    provider: "模型拒绝了请求",
    context_overflow: "超出上下文窗口",
    local: "本机出错",
};

/** 停下的原因（一句）；运行中与抽完时为 null。 */
export function stopText(status: IngestStatusView): string | null {
    if (status.state !== "stopped") return null;
    const reason = status.stopReason;
    // 徽标已经写着“已停下”，这里说是怎么停的。
    if (!reason || reason.kind === "user") return "手动停下了";
    if (reason.kind === "exited") return "运行它的进程已退出";
    const what = reason.code === "ingest_bad_reply" ? "模型的回复不成形" : (reason.errorKind ? KIND_TEXT[reason.errorKind] : undefined) ?? reason.code;
    return `第 ${status.committed + 1} 章失败：${what}`;
}

/** 失败停下时的下一步。 */
export function nextStepText(status: IngestStatusView): string | null {
    const reason = status.stopReason;
    if (status.state !== "stopped" || reason?.kind !== "failed") return null;
    if (reason.code === "ingest_bad_reply") return `点“继续”重做第 ${status.committed + 1} 章；反复出现时换一个抽取模型（nbstory config set ingest.model）。`;
    switch (reason.errorKind) {
        case "auth":
            return "检查配置里的密钥环境变量（nbstory config show），设好后点“继续”。";
        case "quota":
            return "额度用尽：充值或换一个模型后点“继续”。";
        case "provider":
            return "模型不接受抽取固定的推理档或请求：换一个抽取模型（nbstory config set ingest.model）后点“继续”。";
        case "context_overflow":
            return "这一章连同已有记录超出了模型的上下文窗口：换一个窗口更大的抽取模型后点“继续”。";
        default:
            return "稍后点“继续”接着抽；已经抽完的章都保留。";
    }
}

/** 用时：“38 秒”“4 分 52 秒”“2 时 46 分”“3 天 6 小时”。 */
export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 时 ${String(minutes % 60).padStart(2, "0")} 分`;
    return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

const CURRENCY_SIGN: Record<string, string> = {CNY: "¥", USD: "$"};

/** 费用按币种写，几种币种用“+”连起来；没有价格（空）时为 null。 */
export function formatCosts(costs: {currency: string; amount: number}[]): string | null {
    if (costs.length === 0) return null;
    return costs.map(cost => {
        const sign = CURRENCY_SIGN[cost.currency];
        const write = (amount: string) => (sign ? `${sign}${amount}` : `${amount} ${cost.currency}`);
        if (cost.amount < 0.0001) return `不到 ${write("0.0001")}`;
        return write(cost.amount.toFixed(cost.amount < 0.01 ? 4 : 2));
    }).join(" + ");
}

/** token 数：一万以上写“万”。 */
export function formatTokens(count: number): string {
    if (count < 10_000) return count.toLocaleString("zh-CN");
    const wan = count / 10_000;
    return `${wan >= 100 ? Math.round(wan).toLocaleString("zh-CN") : wan.toFixed(1)} 万`;
}
