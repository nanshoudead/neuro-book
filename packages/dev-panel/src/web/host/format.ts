import type {NotifyAttempt, RecordedValue, SessionTitle} from "./types.js";

/** 记录字段的显示：状态的中文名与色调；没有字段的显示“未标”，不合规的显示“不合规”（不推断）。 */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const STATUS: Record<string, {label: string; tone: Tone}> = {
    planned: {label: "计划中", tone: "neutral"},
    active: {label: "进行中", tone: "accent"},
    done: {label: "完成", tone: "success"},
    shelved: {label: "搁置", tone: "warning"},
};

/** 状态取值的中文名（状态切换的下拉与确认用）。 */
export function statusLabel(value: string): string {
    return STATUS[value]?.label ?? value;
}

export function statusDisplay(status: RecordedValue): {label: string; tone: Tone; marked: boolean} {
    if (status.origin === "invalid") return {label: "不合规", tone: "danger", marked: true};
    if (status.value === null) return {label: "未标", tone: "neutral", marked: false};
    return {...(STATUS[status.value] ?? {label: status.value, tone: "neutral"}), marked: true};
}

/** `YYYY-MM-DD` 或 ISO 时刻到现在的天数（按本地日期算）。 */
export function daysSince(value: string, now: Date = new Date()): number {
    const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((today.getTime() - day.getTime()) / 86_400_000);
}

export function relativeTime(iso: string, now: Date = new Date()): string {
    const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
}

export function relativeDay(value: string, now: Date = new Date()): string {
    const days = daysSince(value, now);
    if (days <= 0) return "今天";
    if (days === 1) return "昨天";
    return days < 60 ? `${days} 天前` : value.slice(0, 10);
}

/** 会话键的短写：`claude:<uuid>` 取前 8 位；omp 的会话文件路径只留文件名。 */
export function shortSession(key: string, label: string | null = null): string {
    if (label) return label;
    const [agent, ...rest] = key.split(":");
    const id = rest.join(":");
    const short = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1).replace(/\.jsonl$/u, "").slice(-12) : id.slice(0, 8);
    return `${agent} ${short}`;
}

/**
 * “谁”这一类地方（租约、提问者、服务的属主）显示的会话名（t17）：会话文件里的标题加短键。短键始终带着：
 * 标题不唯一（`--resume`、fork 沿用同一个标题），还能被改成任意文字，同名的两个会话靠短键区分。
 * “核对发给哪个会话”的句子（通知、会话更换）不用它，只写短键。`titles` 是视图数据里的 `sessionTitles`。
 */
export type SessionName = {title: string | null; short: string; source: SessionTitle["source"] | null};
export function sessionName(key: string, label: string | null, titles: Readonly<Record<string, SessionTitle>>): SessionName {
    const title = Object.hasOwn(titles, key) ? titles[key]! : null;
    return {title: title?.text ?? null, short: shortSession(key, label), source: title?.source ?? null};
}

/** 标题从哪里读的（会话页的标题来源行、租约胶囊的提示）。 */
export const TITLE_SOURCE: Record<SessionTitle["source"], string> = {"claude-custom": "Claude Code（/rename）", "claude-agent-name": "Claude Code 的会话名", "claude-ai-title": "Claude Code 自动起的标题", codex: "Codex 的 thread_name", omp: "omp 的会话标题"};

export function taskLabel(taskId: string): string {
    return taskId.slice(0, taskId.indexOf("-") > 0 ? taskId.indexOf("-") : undefined);
}

export function workLabel(workId: string): string {
    return workId.slice(0, 6);
}

/**
 * 要开发者马上看终端的通知尝试（醒目色调、算进要处理的条数，可以逐条“知道了”）：投递途中面板退出、投进了确认界面、换了会话、结果未知。
 * 旧记录里的 `state_jumped` 不算：那是按状态序号的差值判的，别的会话同时变状态就会误报（t11 的通知误报）。
 */
export function attemptNeedsAttention(attempt: Pick<NotifyAttempt, "intentOnly" | "result" | "code">): boolean {
    if (attempt.intentOnly) return true;
    if (attempt.result === "delivered_into_blocked") return attempt.code !== "state_jumped";
    return attempt.result === "delivered_maybe_wrong_session" || attempt.result === "uncertain";
}

export const HERDR_STATUS_LABEL: Record<string, string> = {idle: "空闲", working: "工作中", blocked: "受阻", done: "完成一轮", unknown: "未知", unmanaged: "不在 herdr 里"};
