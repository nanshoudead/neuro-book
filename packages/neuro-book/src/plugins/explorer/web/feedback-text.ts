/**
 * 结果区与内联输入的文字：把控制器给出的失败码、动作与逐项结果换成当前显示语言的说明。常见的失败码换成可读的原因，
 * 不认识的原样带上服务端的说明。文字经翻译端口解析（`TextResolver`），在渲染期调用才随语言切换更新。
 */

import type {TextResolver} from "nbook/shared/localized-text";

import {explorerText} from "../shared/text";
import type {ExplorerTextKey} from "../shared/text";
import type {ActionName, NameError, Notice, ReportResult, UnavailableReason} from "./controller";

const ACTIONS: Readonly<Record<ActionName, ExplorerTextKey>> = {
    "create": "actions.create",
    "rename": "actions.rename",
    "delete": "actions.delete",
    "create-content": "actions.create-content",
    "convert": "actions.convert",
    "display": "actions.display",
    "include": "actions.include",
    "drop": "actions.drop",
    "reorder": "actions.reorder",
    "copy": "actions.copy",
    "cut": "actions.cut",
    "move": "actions.move",
};

const CODES: Readonly<Record<string, ExplorerTextKey>> = {
    "conflict": "reasons.conflict",
    "source-changed": "reasons.source-changed",
    "permission-denied": "reasons.permission-denied",
    "busy": "reasons.busy",
    "not-found": "reasons.not-found",
    "unknown-outcome": "reasons.unknown-outcome",
    "document-unsettled": "reasons.document-unsettled",
};

export function actionText(text: TextResolver, action: ActionName): string {
    return text.t(explorerText(ACTIONS[action]));
}

export function reasonText(text: TextResolver, code: string, detail: string): string {
    const known = CODES[code];
    return known === undefined ? `${code}：${detail}` : text.t(explorerText(known));
}

export function noticeText(text: TextResolver, notice: Notice): string {
    switch (notice.kind) {
        case "editor-missing":
            return text.t(explorerText("feedback.notice.editorMissing", {address: notice.address}));
        case "open-failed":
            return text.t(explorerText("feedback.notice.openFailed", {address: notice.address, reason: notice.reason}));
        case "failed":
            return text.t(explorerText("feedback.notice.failed", {action: actionText(text, notice.action), address: notice.address, reason: reasonText(text, notice.code, notice.detail)}));
        case "manifest":
            return notice.issues.map((issue) => text.t(explorerText("feedback.manifestNotUpdated", {action: actionText(text, notice.action), path: issue.path, reason: issue.detail}))).join("\n");
    }
}

export function nameErrorText(text: TextResolver, error: NameError): string {
    switch (error.code) {
        case "empty":
            return text.t(explorerText("nameErrors.empty"));
        case "invalid":
            return text.t(explorerText("nameErrors.invalid"));
        case "conflict":
            return text.t(explorerText("reasons.conflict"));
        case "failed":
            return error.detail;
        case "unsettled":
            return text.t(explorerText("nameErrors.unsettled", {documents: error.detail}));
    }
}

export function itemText(text: TextResolver, result: ReportResult): string {
    switch (result.status) {
        case "declined":
            return text.t(explorerText(result.reason === "skip" ? "feedback.item.declinedSkip" : "feedback.item.declinedCancel"));
        case "done":
            return text.t(explorerText("feedback.item.done"));
        case "failed":
            return text.t(explorerText("feedback.item.failed", {reason: reasonText(text, result.code, result.detail)}));
        case "skipped":
            return text.t(explorerText("feedback.item.skipped"));
        case "not-run":
            return text.t(explorerText("feedback.item.notRun"));
        case "cancelled":
            return text.t(explorerText("feedback.item.cancelled"));
    }
}

const UNAVAILABLE: Readonly<Record<UnavailableReason, ExplorerTextKey>> = {
    "no-target": "unavailable.noTarget",
    "no-selection": "unavailable.noSelection",
    "not-applicable": "unavailable.notApplicable",
    "busy": "unavailable.busy",
    "stopped": "unavailable.notReady",
    "unknown-outcome": "unavailable.unknown",
    "empty-clipboard": "unavailable.emptyClipboard",
    "cross-root": "unavailable.crossRoot",
    "copy-failed": "unavailable.copyFailed",
};

export function unavailableText(text: TextResolver, reason: UnavailableReason): string {
    return text.t(explorerText(UNAVAILABLE[reason]));
}
