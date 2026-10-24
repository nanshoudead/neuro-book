/**
 * 用户从命令面板或快捷键执行命令失败时的通知（docs/specs/workbench/commands.md 的“执行入口”）：点了没反应是作者与用户都
 * 看不出原因的失败。只对用户这两个入口；Agent 与代码调用拿到的是结构化结果，自己处理。
 */

import type {CommandFailureCode, CommandMetadata} from "nbook/plugins/commands/shared/contracts";
import {textOf} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {NotificationInput} from "../../shared/contracts";
import {paletteText} from "./palette-messages";

/**
 * 要告诉用户的失败。`stale-target` 不弹：等待期间用户自己换了目标（条目被替换、视图被移走），再弹一条是噪声；
 * `not-exposed`、`read-only`、`confirmation-required` 只对 Agent 的调用出现。
 */
const NOTIFIED: ReadonlySet<CommandFailureCode> = new Set<CommandFailureCode>(["invalid-args", "execution-error", "unavailable", "unknown-command", "denied"]);

/** 失败要弹的通知；不弹的码为 null。警告级，按色调自动消失，不在页面上留常驻的错误。 */
export function failureNotice(id: string, metadata: CommandMetadata | null, failure: {readonly code: CommandFailureCode; readonly reason: string}, locale: DisplayLocale): NotificationInput | null {
    if (!NOTIFIED.has(failure.code)) return null;
    const title = metadata === null ? id : textOf(metadata.title, locale);
    return {
        tone: "warning",
        title: paletteText(locale, "commandFailed", {title}),
        message: failure.code === "invalid-args" ? paletteText(locale, "commandNeedsArgs") : failure.reason,
    };
}
