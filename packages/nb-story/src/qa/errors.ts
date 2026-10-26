/**
 * 问答在开始运行之前的失败（docs/specs/story/qa.md 的 F1、F3、F8），写配置失败（F7）与写配置时发现别处改过（`config_conflict`），
 * 以及网页问答的对话正忙（`qa_busy`：这个对话已有一轮在跑，或对话、书正在删除，或服务正在停止）。运行开始之后的
 * 失败（F2、F4）不抛出，写进记录、作为一问的结果返回。
 */

export type QaErrorCode = "qa_unconfigured" | "qa_config_write_failed" | "config_conflict" | "full_read_unavailable" | "qa_not_continuable" | "qa_busy";

export class QaError extends Error {
    readonly code: QaErrorCode;

    constructor(code: QaErrorCode, message: string, options: {cause?: unknown} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "QaError";
        this.code = code;
    }
}
