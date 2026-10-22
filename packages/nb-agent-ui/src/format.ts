/**
 * 界面上几处共用的小格式：角色行的时刻、折叠行露出的第一行。
 */
import type {AgentLocale} from "./types";

/** 24 小时制的时:分:秒，按界面语言。 */
export function formatClock(timestamp: number, locale: AgentLocale): string {
    return new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(timestamp);
}

/** 去掉首尾空白后的第一行；折叠的思考、提醒与排队消息只露出它。 */
export function firstLine(text: string): string {
    return text.trim().split("\n", 1)[0] ?? "";
}
