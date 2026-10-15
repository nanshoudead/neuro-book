/**
 * 查询接口的失败：码、含义与 HTTP 状态码见 docs/specs/story/queries.md 的“失败与恢复”。
 * 核心库只抛 StoryError；命令行与独立服务按 `code` 分支，不看 `message`。
 */

export const STORY_ERROR_CODES = [
    "book_not_found",
    "book_ambiguous",
    "book_exists",
    "unsupported_format",
    "position_out_of_range",
    "beyond_position",
    "entity_not_found",
    "entity_ambiguous",
    "invalid_params",
    "cursor_invalid",
    "state_too_large",
    "unauthorized",
] as const;

export type StoryErrorCode = (typeof STORY_ERROR_CODES)[number];

export const HTTP_STATUS: Readonly<Record<StoryErrorCode, number>> = {
    book_not_found: 404,
    book_ambiguous: 400,
    book_exists: 409,
    unsupported_format: 415,
    position_out_of_range: 400,
    beyond_position: 403,
    entity_not_found: 404,
    entity_ambiguous: 409,
    invalid_params: 400,
    cursor_invalid: 410,
    state_too_large: 413,
    unauthorized: 401,
};

/** `entity_ambiguous` 时列出的候选。 */
export interface EntityCandidate {
    id: string;
    label: string;
    note: string;
}

export class StoryError extends Error {
    readonly code: StoryErrorCode;
    readonly candidates?: EntityCandidate[];

    constructor(code: StoryErrorCode, message: string, options: {candidates?: EntityCandidate[]; cause?: unknown} = {}) {
        super(message, options.cause === undefined ? undefined : {cause: options.cause});
        this.name = "StoryError";
        this.code = code;
        if (options.candidates) this.candidates = options.candidates;
    }
}

/** 文件系统错误的 `code`（ENOENT 之类）；不是系统错误时为 undefined。 */
export function systemErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
