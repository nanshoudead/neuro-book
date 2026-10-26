/**
 * harness 抛出的合同错误（docs/specs/agent/harness.md “失败与恢复” F1 到 F8）。调用方按 `code` 分支，不按文字。
 * 运行期的模型与本地错误不抛，按 `TurnResult.error` 返回（见 run-result.ts）。
 */

export type HarnessErrorCode =
    | "tool_unavailable"
    | "tool_name_conflict"
    | "invalid_initial"
    | "profile_invalid"
    | "session_incompatible"
    | "session_busy"
    | "session_closed"
    | "profile_has_tools";

export class HarnessError extends Error {
    constructor(
        readonly code: HarnessErrorCode,
        message: string,
        readonly details: Readonly<Record<string, unknown>> = {},
    ) {
        super(message);
        this.name = "HarnessError";
    }
}
