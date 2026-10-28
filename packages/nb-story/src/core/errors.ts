/**
 * 查询接口的失败：码、含义与 HTTP 状态码见 docs/specs/story/queries.md 的“失败与恢复”；`qa_record_not_found`、`qa_record_broken` 见
 * docs/specs/story/qa.md 的 F5、F6；`ingest_*` 见 docs/specs/story/ingest.md 的 F1 到 F3；`revision_*`、`evidence_invalid` 见 docs/specs/story/revisions.md 的 R1 到 R5。
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
    "record_not_found",
    "invalid_params",
    "cursor_invalid",
    "state_too_large",
    "unauthorized",
    "qa_record_not_found",
    "qa_record_broken",
    "ingest_bad_text",
    "ingest_text_changed",
    "ingest_running",
    "revision_target_not_found",
    "revision_not_candidate",
    "revision_conflict",
    "revision_not_found",
    "evidence_invalid",
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
    record_not_found: 404,
    invalid_params: 400,
    cursor_invalid: 410,
    state_too_large: 413,
    unauthorized: 401,
    qa_record_not_found: 404,
    qa_record_broken: 422,
    ingest_bad_text: 400,
    ingest_text_changed: 409,
    ingest_running: 409,
    revision_target_not_found: 404,
    revision_not_candidate: 409,
    revision_conflict: 409,
    revision_not_found: 404,
    evidence_invalid: 400,
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
