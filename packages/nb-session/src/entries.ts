/** JSON 值：nb-session 自带，不依赖任何外部 JSON 类型。 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {readonly [key: string]: JsonValue};

/** 会话条目的公共字段：`seq` 由 log 打戳（1 起、单调递增），`at` 为 ISO 字符串。 */
export interface SessionEntryBase {
    readonly seq: number;
    readonly at: string;
}

export interface MessageEntry extends SessionEntryBase {
    readonly kind: "message";
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
}

export interface ToolCallEntry extends SessionEntryBase {
    readonly kind: "tool_call";
    readonly callId: string;
    readonly toolName: string;
    readonly argsJson: string;
}

export interface ToolResultEntry extends SessionEntryBase {
    readonly kind: "tool_result";
    readonly callId: string;
    readonly isError: boolean;
    readonly text: string;
}

export interface CompactionEntry extends SessionEntryBase {
    readonly kind: "compaction";
    readonly summary: string;
    readonly replacedThroughSeq: number;
}

export interface MetaEntry extends SessionEntryBase {
    readonly kind: "meta";
    readonly key: string;
    readonly value: JsonValue;
}

/**
 * 会话的第一条条目：Profile 的身份、校验过的初始输入与生效工具集的声明（docs/specs/agent/harness.md 输出 3）。
 * 工具声明的形状由 harness 定，这里只按 JSON 存取。
 */
export interface SessionSnapshotEntry extends SessionEntryBase {
    readonly kind: "session_snapshot";
    readonly profile: {readonly key: string; readonly version: string};
    readonly initial: JsonValue;
    readonly tools: readonly JsonValue[];
}

/** 模型消息或工具结果的原样（harness 写 OMP 的 AgentMessage），恢复会话时逐字段交回模型。 */
export interface AgentMessageEntry extends SessionEntryBase {
    readonly kind: "agent_message";
    readonly message: JsonValue;
}

/** 一条模型消息的用量；`cost` 为 null 表示单价未知。 */
export interface UsageEntry extends SessionEntryBase {
    readonly kind: "usage";
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly cost: number | null;
}

/** 一次运行以出错或取消结束时记下原因；正常结束不记。 */
export interface RunEndEntry extends SessionEntryBase {
    readonly kind: "run_end";
    readonly stopReason: string;
    readonly error: JsonValue;
}

/**
 * `message`、`tool_call`、`tool_result` 是只存文字的旧条目：harness 不再写，旧日志仍可读。
 */
export type SessionEntry =
    | MessageEntry
    | ToolCallEntry
    | ToolResultEntry
    | CompactionEntry
    | MetaEntry
    | SessionSnapshotEntry
    | AgentMessageEntry
    | UsageEntry
    | RunEndEntry;

/** `append` 的入参：不含 `seq`/`at`，由 log 打戳。 */
export type SessionEntryInput =
    | {readonly kind: "message"; readonly role: MessageEntry["role"]; readonly text: string}
    | {readonly kind: "tool_call"; readonly callId: string; readonly toolName: string; readonly argsJson: string}
    | {readonly kind: "tool_result"; readonly callId: string; readonly isError: boolean; readonly text: string}
    | {readonly kind: "compaction"; readonly summary: string; readonly replacedThroughSeq: number}
    | {readonly kind: "meta"; readonly key: string; readonly value: JsonValue}
    | Omit<SessionSnapshotEntry, keyof SessionEntryBase>
    | Omit<AgentMessageEntry, keyof SessionEntryBase>
    | Omit<UsageEntry, keyof SessionEntryBase>
    | Omit<RunEndEntry, keyof SessionEntryBase>;

/** 可读写的会话 id 形状；用于文件名，避免路径穿越。 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidSessionId(sessionId: string): boolean {
    return SESSION_ID_PATTERN.test(sessionId);
}

/** 把一条入参打戳成完整条目。 */
export function materializeEntry(input: SessionEntryInput, seq: number, at: string): SessionEntry {
    switch (input.kind) {
        case "message":
            return {kind: "message", seq, at, role: input.role, text: input.text};
        case "tool_call":
            return {kind: "tool_call", seq, at, callId: input.callId, toolName: input.toolName, argsJson: input.argsJson};
        case "tool_result":
            return {kind: "tool_result", seq, at, callId: input.callId, isError: input.isError, text: input.text};
        case "compaction":
            return {kind: "compaction", seq, at, summary: input.summary, replacedThroughSeq: input.replacedThroughSeq};
        case "meta":
            return {kind: "meta", seq, at, key: input.key, value: input.value};
        case "session_snapshot":
            return {kind: "session_snapshot", seq, at, profile: input.profile, initial: input.initial, tools: input.tools};
        case "agent_message":
            return {kind: "agent_message", seq, at, message: input.message};
        case "usage":
            return {kind: "usage", seq, at, input: input.input, output: input.output, cacheRead: input.cacheRead, cacheWrite: input.cacheWrite, cost: input.cost};
        case "run_end":
            return {kind: "run_end", seq, at, stopReason: input.stopReason, error: input.error};
    }
}

const KINDS = new Set(["message", "tool_call", "tool_result", "compaction", "meta", "session_snapshot", "agent_message", "usage", "run_end"]);
const ROLES = new Set(["user", "assistant", "system"]);

/** 解析一行 JSONL；字段不合法或 JSON 损坏时返回 null（调用方据此判定中断尾）。 */
export function parseEntryLine(line: string): SessionEntry | null {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Record<string, unknown>;
    const kind = candidate.kind;
    const seq = candidate.seq;
    const at = candidate.at;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;
    if (typeof at !== "string") return null;
    switch (kind) {
        case "message":
            return typeof candidate.role === "string" && ROLES.has(candidate.role) && typeof candidate.text === "string"
                ? (value as MessageEntry)
                : null;
        case "tool_call":
            return typeof candidate.callId === "string" && typeof candidate.toolName === "string" && typeof candidate.argsJson === "string"
                ? (value as ToolCallEntry)
                : null;
        case "tool_result":
            return typeof candidate.callId === "string" && typeof candidate.isError === "boolean" && typeof candidate.text === "string"
                ? (value as ToolResultEntry)
                : null;
        case "compaction":
            return typeof candidate.summary === "string" && typeof candidate.replacedThroughSeq === "number"
                ? (value as CompactionEntry)
                : null;
        case "meta":
            return typeof candidate.key === "string" ? (value as MetaEntry) : null;
        case "session_snapshot": {
            const profile = candidate.profile as Record<string, unknown> | null | undefined;
            return typeof profile === "object" && profile !== null && typeof profile.key === "string" && typeof profile.version === "string" && "initial" in candidate && Array.isArray(candidate.tools)
                ? (value as SessionSnapshotEntry)
                : null;
        }
        case "agent_message":
            return typeof candidate.message === "object" && candidate.message !== null ? (value as AgentMessageEntry) : null;
        case "usage":
            return ["input", "output", "cacheRead", "cacheWrite"].every((key) => typeof candidate[key] === "number") && (candidate.cost === null || typeof candidate.cost === "number")
                ? (value as UsageEntry)
                : null;
        case "run_end":
            return typeof candidate.stopReason === "string" && "error" in candidate ? (value as RunEndEntry) : null;
        default:
            return null;
    }
}
