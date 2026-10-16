/**
 * 问答在开始运行之前的失败（docs/specs/story/qa.md 的 F1、F3），以及 `nbstory config` 写配置失败（F7）。运行开始之后的
 * 失败（F2、F4）不抛出，写进记录、作为一问的结果返回。
 */

export type QaErrorCode = "qa_unconfigured" | "qa_config_write_failed" | "full_read_unavailable";

export class QaError extends Error {
    readonly code: QaErrorCode;

    constructor(code: QaErrorCode, message: string, options: {cause?: unknown} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "QaError";
        this.code = code;
    }
}
