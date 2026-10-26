import type {JsonValue} from "nbook/server/agent/messages/types";
import type {
    StoredAgentMessage,
    StoredAgentUserMessageInput,
    StoredAttachmentContent,
    StoredFollowUpQueueItem,
    StoredFollowUpQueuePause,
    StoredFollowUpQueueState,
    StoredInvocationCaller,
} from "nbook/server/agent/messages/stored-types";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

const ATTACHMENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
/** 与 Pi `StopReason` 对齐；含 1.3 新增的 pending / deferred。 */
const ASSISTANT_STOP_REASONS = new Set(["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"]);
const MODEL_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const FOLLOW_UP_PAUSE_REASONS = new Set(["error", "aborted", "interrupted", "admission_error"]);
const USER_MESSAGE_KEYS = new Set(["role", "content", "timestamp"]);
/** Pi 1.3 toolResult 可带 usage / nestedCalls / durationMs。 */
const TOOL_RESULT_MESSAGE_KEYS = new Set(["role", "toolCallId", "toolName", "content", "details", "usage", "nestedCalls", "isError", "timestamp", "durationMs"]);
/**
 * Pi 1.3 AssistantMessage 新增字段：Google 会写 rawStopReason，EventStream 写 durationMs，
 * Agent loop 写 thinkingLevel；其余为 Provider 可选元数据。
 */
const ASSISTANT_MESSAGE_KEYS = new Set([
    "role", "content", "api", "provider", "model", "responseModel", "responseId",
    "providerThinkingLevel", "thinkingLevel", "diagnostics", "usage", "stopReason",
    "deferred", "errorMessage", "rawStopReason", "endTurn", "timestamp", "durationMs",
]);
const TEXT_CONTENT_KEYS = new Set(["type", "text", "textSignature"]);
const THINKING_CONTENT_KEYS = new Set(["type", "thinking", "thinkingSignature", "redacted"]);
const TOOL_CALL_KEYS = new Set(["type", "id", "name", "arguments", "thoughtSignature", "namespace", "argumentsError"]);
const USAGE_KEYS = new Set(["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens", "cost"]);
const COST_KEYS = new Set(["input", "output", "cacheRead", "cacheWrite", "total"]);
const DEFERRED_HANDLE_KEYS = new Set(["provider", "modelId", "api", "id", "expiresAt", "pollAfterMs", "data"]);
const NESTED_TOOL_CALLS_KEYS = new Set(["calls", "complete"]);
const NESTED_TOOL_CALL_RECORD_KEYS = new Set(["id", "name", "arguments", "argumentsBytes", "status", "durationMs", "error"]);
const NESTED_TOOL_CALL_STATUSES = new Set(["ok", "error", "unfinished"]);

export type StoredMessageInvariantCode = "migration_required" | "corrupt";

/** Stored message/queue 违反硬切合同。 */
export class StoredMessageInvariantError extends Error {
    constructor(readonly code: StoredMessageInvariantCode, message: string) {
        super(message);
        this.name = "StoredMessageInvariantError";
    }
}

/** 严格解析一条 JSONL、RunFrame 或 runtime ingress stored message。 */
export function parseStoredMessage(value: unknown): StoredAgentMessage {
    const message = objectValue(value, "Stored message 必须是对象。");
    if ((message.role === "user" || message.role === "toolResult")
        && Array.isArray(message.content)
        && message.content.some((block) => objectType(block) === "image")) {
        throw new StoredMessageInvariantError("migration_required", `Stored ${message.role} 仍包含 Pi raw image。`);
    }
    if (message.role === "user") {
        requireExactKeys(message, USER_MESSAGE_KEYS, "Stored user message 包含未声明字段。");
        requireFiniteNumber(message.timestamp, "Stored user message 缺少合法 timestamp。");
        parseStoredContentArray(message.content, "user");
        return value as StoredAgentMessage;
    }
    if (message.role === "toolResult") {
        requireExactKeys(message, TOOL_RESULT_MESSAGE_KEYS, "Stored toolResult message 包含未声明字段。");
        requireString(message.toolCallId, "Stored toolResult 缺少 toolCallId。");
        assertPublicToolCallId(message.toolCallId);
        requireString(message.toolName, "Stored toolResult 缺少 toolName。");
        parseStoredContentArray(message.content, "toolResult");
        if (typeof message.isError !== "boolean") {
            corrupt("Stored toolResult 缺少 isError。");
        }
        requireFiniteNumber(message.timestamp, "Stored toolResult 缺少合法 timestamp。");
        if (message.details !== undefined && !isJsonValue(message.details)) {
            corrupt("Stored toolResult details 不是 JSON value。");
        }
        if (message.usage !== undefined) {
            parseUsage(message.usage, "Stored toolResult");
        }
        if (message.nestedCalls !== undefined) {
            parseNestedToolCalls(message.nestedCalls);
        }
        if (message.durationMs !== undefined) {
            requireFiniteNumber(message.durationMs, "Stored toolResult durationMs 非法。");
        }
        return value as StoredAgentMessage;
    }
    if (message.role === "assistant") {
        parseAssistantMessage(message);
        return value as StoredAgentMessage;
    }
    corrupt("Stored message role 非法。");
}

/** 严格解析一组 stored messages；Provider hydration 前必须再次经过此门禁。 */
export function parseStoredMessages(value: unknown): StoredAgentMessage[] {
    if (!Array.isArray(value)) {
        corrupt("Stored messages 必须是数组。");
    }
    return value.map((message) => parseStoredMessage(message));
}

/** 严格解析 admission 后的用户输入引用态。 */
export function parseStoredInput(value: unknown): StoredAgentUserMessageInput {
    const input = objectValue(value, "Stored user input 必须是对象。");
    requireExactKeys(input, new Set(["content"]), "Stored user input 包含未声明字段。");
    if (!Array.isArray(input.content)) {
        corrupt("Stored user input content 必须是数组。");
    }
    parseStoredContentArray(input.content, "user");
    return value as StoredAgentUserMessageInput;
}

/** 严格解析持久化 follow-up queue；坏 queue 不得静默过滤后继续运行。 */
export function parseFollowUpQueue(value: unknown): StoredFollowUpQueueState {
    const queue = objectValue(value, "Stored follow-up queue 必须是对象。");
    requireExactKeys(queue, new Set(["status", "pausedBy", "items"]), "Stored follow-up queue 包含未声明字段。");
    if (queue.status !== "ready" && queue.status !== "paused") {
        corrupt("Stored follow-up queue status 非法。");
    }
    if (!Array.isArray(queue.items)) {
        corrupt("Stored follow-up queue items 必须是数组。");
    }
    const items = queue.items.map((item) => parseFollowUpQueueItem(item));
    if (queue.status === "ready") {
        if (queue.pausedBy !== undefined) {
            corrupt("Ready follow-up queue 不允许 pausedBy。");
        }
        return {status: "ready", items};
    }
    return {
        status: "paused",
        pausedBy: parseFollowUpQueuePause(queue.pausedBy),
        items,
    };
}

/** 将已校验 follow-up queue 编码为 custom-state JsonValue。 */
export function encodeFollowUpQueue(value: StoredFollowUpQueueState): JsonValue {
    const queue = parseFollowUpQueue(value);
    const items: JsonValue[] = queue.items.map((item) => ({
        id: item.id,
        clientMessageId: item.clientMessageId,
        kind: item.kind,
        ...(item.message ? {message: encodeStoredInput(item.message)} : {}),
        ...(item.input === undefined ? {} : {input: item.input}),
        ...(item.modelKey === undefined ? {} : {modelKey: item.modelKey}),
        ...(item.caller === undefined ? {} : {caller: item.caller}),
        ...(item.messageIdentity === undefined ? {} : {messageIdentity: item.messageIdentity}),
        createdAt: item.createdAt,
    }));
    if (queue.status === "ready") {
        return {status: "ready", items};
    }
    return {
        status: "paused",
        pausedBy: {
            invocationId: queue.pausedBy.invocationId,
            ...(queue.pausedBy.itemId === undefined ? {} : {itemId: queue.pausedBy.itemId}),
            reason: queue.pausedBy.reason,
            ...(queue.pausedBy.message === undefined ? {} : {message: queue.pausedBy.message}),
        },
        items,
    };
}

function parseStoredContentArray(value: unknown, owner: "user" | "toolResult"): void {
    if (!Array.isArray(value)) {
        corrupt(`Stored ${owner} content 必须是数组。`);
    }
    for (const block of value) {
        const content = objectValue(block, `Stored ${owner} content block 必须是对象。`);
        if (content.type === "image") {
            throw new StoredMessageInvariantError("migration_required", `Stored ${owner} 仍包含 Pi raw image。`);
        }
        if (content.type === "text") {
            requireExactKeys(content, TEXT_CONTENT_KEYS, `Stored ${owner} text block 包含未声明字段。`);
            requireString(content.text, `Stored ${owner} text block 缺少 text。`);
            if (content.textSignature !== undefined && typeof content.textSignature !== "string") {
                corrupt(`Stored ${owner} textSignature 非法。`);
            }
            continue;
        }
        if (content.type === "attachment") {
            parseStoredAttachment(content);
            continue;
        }
        corrupt(`Stored ${owner} content block type 非法。`);
    }
}

/** 严格解析单个 stored attachment block，供 projection entry 复用同一不变量。 */
export function parseStoredAttachment(value: unknown): StoredAttachmentContent {
    const block = objectValue(value, "Stored attachment block 必须是对象。");
    requireExactKeys(block, new Set(["type", "attachment", "name"]), "Stored attachment block 包含未声明字段。");
    if (block.type !== "attachment") {
        corrupt("Stored attachment block type 非法。");
    }
    const attachment = objectValue(block.attachment, "Stored attachment ref 必须是对象。");
    requireExactKeys(attachment, new Set(["id", "mimeType", "bytes"]), "Stored attachment ref 包含未声明字段。");
    if (typeof attachment.id !== "string" || !ATTACHMENT_ID_PATTERN.test(attachment.id)) {
        corrupt("Stored attachment id 非法。");
    }
    if (typeof attachment.mimeType !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(attachment.mimeType)) {
        corrupt("Stored attachment mimeType 非法。");
    }
    if (!Number.isSafeInteger(attachment.bytes) || (attachment.bytes as number) < 0) {
        corrupt("Stored attachment bytes 非法。");
    }
    if (block.name !== undefined && typeof block.name !== "string") {
        corrupt("Stored attachment name 非法。");
    }
    return value as StoredAttachmentContent;
}

function parseAssistantMessage(message: Record<string, unknown>): void {
    requireExactKeys(message, ASSISTANT_MESSAGE_KEYS, "Stored assistant message 包含未声明字段。");
    if (!Array.isArray(message.content)) {
        corrupt("Stored assistant content 必须是数组。");
    }
    for (const blockValue of message.content) {
        const block = objectValue(blockValue, "Stored assistant content block 必须是对象。");
        if (block.type === "image") {
            throw new StoredMessageInvariantError("migration_required", "Stored assistant 仍包含 Pi raw image。");
        }
        if (block.type === "attachment") {
            corrupt("Stored assistant 不允许 attachment block。");
        }
        if (block.type === "text") {
            requireExactKeys(block, TEXT_CONTENT_KEYS, "Stored assistant text block 包含未声明字段。");
            requireString(block.text, "Stored assistant text block 缺少 text。");
            if (block.textSignature !== undefined && typeof block.textSignature !== "string") {
                corrupt("Stored assistant textSignature 非法。");
            }
            continue;
        }
        if (block.type === "thinking") {
            requireExactKeys(block, THINKING_CONTENT_KEYS, "Stored assistant thinking block 包含未声明字段。");
            requireString(block.thinking, "Stored assistant thinking block 缺少 thinking。");
            if (block.thinkingSignature !== undefined && typeof block.thinkingSignature !== "string") {
                corrupt("Stored assistant thinkingSignature 非法。");
            }
            if (block.redacted !== undefined && typeof block.redacted !== "boolean") {
                corrupt("Stored assistant redacted 非法。");
            }
            continue;
        }
        if (block.type === "toolCall") {
            requireExactKeys(block, TOOL_CALL_KEYS, "Stored assistant toolCall block 包含未声明字段。");
            requireString(block.id, "Stored assistant toolCall 缺少 id。");
            assertPublicToolCallId(block.id);
            requireString(block.name, "Stored assistant toolCall 缺少 name。");
            if (!isJsonObject(block.arguments)) {
                corrupt("Stored assistant toolCall arguments 不是 JSON object。");
            }
            if (block.thoughtSignature !== undefined && typeof block.thoughtSignature !== "string") {
                corrupt("Stored assistant thoughtSignature 非法。");
            }
            if (block.namespace !== undefined && typeof block.namespace !== "string") {
                corrupt("Stored assistant toolCall namespace 非法。");
            }
            if (block.argumentsError !== undefined && typeof block.argumentsError !== "string") {
                corrupt("Stored assistant toolCall argumentsError 非法。");
            }
            continue;
        }
        corrupt("Stored assistant content block type 非法。");
    }
    requireString(message.api, "Stored assistant 缺少 api。");
    requireString(message.provider, "Stored assistant 缺少 provider。");
    requireString(message.model, "Stored assistant 缺少 model。");
    if (!ASSISTANT_STOP_REASONS.has(String(message.stopReason))) {
        corrupt("Stored assistant stopReason 非法。");
    }
    requireFiniteNumber(message.timestamp, "Stored assistant 缺少合法 timestamp。");
    parseUsage(message.usage, "Stored assistant");
    for (const key of ["responseModel", "responseId", "errorMessage", "rawStopReason", "providerThinkingLevel"] as const) {
        if (message[key] !== undefined && typeof message[key] !== "string") {
            corrupt(`Stored assistant ${key} 非法。`);
        }
    }
    if (message.thinkingLevel !== undefined && (typeof message.thinkingLevel !== "string" || !MODEL_THINKING_LEVELS.has(message.thinkingLevel))) {
        corrupt("Stored assistant thinkingLevel 非法。");
    }
    if (message.endTurn !== undefined && typeof message.endTurn !== "boolean") {
        corrupt("Stored assistant endTurn 非法。");
    }
    if (message.durationMs !== undefined) {
        requireFiniteNumber(message.durationMs, "Stored assistant durationMs 非法。");
    }
    if (message.deferred !== undefined) {
        parseDeferredHandle(message.deferred);
    }
    if (message.diagnostics !== undefined && !isJsonValue(message.diagnostics)) {
        corrupt("Stored assistant diagnostics 不是 JSON value。");
    }
}

function parseFollowUpQueueItem(value: unknown): StoredFollowUpQueueItem {
    const item = objectValue(value, "Stored follow-up item 必须是对象。");
    requireExactKeys(item, new Set(["id", "clientMessageId", "kind", "message", "input", "modelKey", "caller", "messageIdentity", "createdAt"]), "Stored follow-up item 包含未声明字段。");
    requireString(item.id, "Stored follow-up item 缺少 id。");
    requireString(item.clientMessageId, "Stored follow-up item 缺少 clientMessageId。");
    if (item.kind !== "followup") {
        corrupt("Stored follow-up item kind 非法。");
    }
    if (item.message === undefined && item.input === undefined) {
        corrupt("Stored follow-up item 必须包含 message 或 input。");
    }
    const message = item.message === undefined ? undefined : parseStoredInput(item.message);
    if (item.input !== undefined && !isJsonValue(item.input)) {
        corrupt("Stored follow-up item input 不是 JSON value。");
    }
    if (item.modelKey !== undefined) {
        requireString(item.modelKey, "Stored follow-up item modelKey 非法。");
        if (!item.modelKey.trim()) {
            corrupt("Stored follow-up item modelKey 不能为空。");
        }
    }
    const caller = item.caller === undefined ? undefined : parseStoredInvocationCaller(item.caller);
    // 旧队列没有显式身份时保留缺省，drain 边界按用户消息兼容；新写入始终带身份。
    const messageIdentity = item.messageIdentity;
    if (messageIdentity !== undefined && messageIdentity !== "user" && messageIdentity !== "system") {
        corrupt("Stored follow-up messageIdentity 非法。");
    }
    requireFiniteNumber(item.createdAt, "Stored follow-up item createdAt 非法。");
    return {
        id: item.id,
        clientMessageId: item.clientMessageId,
        kind: "followup",
        ...(message ? {message} : {}),
        ...(item.input === undefined ? {} : {input: item.input}),
        ...(item.modelKey === undefined ? {} : {modelKey: item.modelKey}),
        ...(caller === undefined ? {} : {caller}),
        ...(messageIdentity === undefined ? {} : {messageIdentity}),
        createdAt: item.createdAt,
    };
}

/** 严格解析持久化队列中的调用方身份。 */
function parseStoredInvocationCaller(value: unknown): StoredInvocationCaller {
    const caller = objectValue(value, "Stored follow-up caller 必须是对象。");
    requireExactKeys(caller, new Set(["kind", "sessionId", "profileKey", "toolCallId"]), "Stored follow-up caller 包含未声明字段。");
    const kind = caller.kind;
    if (kind !== "user" && kind !== "agent" && kind !== "system") {
        corrupt("Stored follow-up caller kind 非法。");
    }
    const sessionId = caller.sessionId;
    if (sessionId !== undefined) {
        if (typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
            corrupt("Stored follow-up caller sessionId 非法。");
        }
    }
    for (const key of ["profileKey", "toolCallId"] as const) {
        if (caller[key] !== undefined) {
            requireString(caller[key], `Stored follow-up caller ${key} 非法。`);
        }
    }
    const profileKey = caller.profileKey;
    const toolCallId = caller.toolCallId;
    if (profileKey !== undefined && typeof profileKey !== "string") {
        corrupt("Stored follow-up caller profileKey 非法。");
    }
    if (toolCallId !== undefined && typeof toolCallId !== "string") {
        corrupt("Stored follow-up caller toolCallId 非法。");
    }
    return {
        kind,
        ...(sessionId === undefined ? {} : {sessionId}),
        ...(profileKey === undefined ? {} : {profileKey}),
        ...(toolCallId === undefined ? {} : {toolCallId}),
    };
}

function parseFollowUpQueuePause(value: unknown): StoredFollowUpQueuePause {
    const pause = objectValue(value, "Paused follow-up queue 缺少 pausedBy。");
    requireExactKeys(pause, new Set(["invocationId", "itemId", "reason", "message"]), "Stored follow-up pausedBy 包含未声明字段。");
    requireString(pause.invocationId, "Stored follow-up pausedBy 缺少 invocationId。");
    if (pause.itemId !== undefined) {
        requireString(pause.itemId, "Stored follow-up pausedBy itemId 非法。");
    }
    if (typeof pause.reason !== "string" || !FOLLOW_UP_PAUSE_REASONS.has(pause.reason)) {
        corrupt("Stored follow-up pausedBy reason 非法。");
    }
    return {
        invocationId: pause.invocationId,
        ...(pause.itemId === undefined ? {} : {itemId: pause.itemId}),
        reason: pause.reason as StoredFollowUpQueuePause["reason"],
        ...(typeof pause.message === "string" ? {message: pause.message} : {}),
    };
}

function encodeStoredInput(value: StoredAgentUserMessageInput): JsonValue {
    const input = parseStoredInput(value);
    return {
        content: input.content.map((block): JsonValue => block.type === "text"
            ? {type: "text", text: block.text}
            : {
                type: "attachment",
                attachment: {
                    id: block.attachment.id,
                    mimeType: block.attachment.mimeType,
                    bytes: block.attachment.bytes,
                },
                ...(block.name === undefined ? {} : {name: block.name}),
            }),
    };
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        corrupt(message);
    }
    return value as Record<string, unknown>;
}

function objectType(value: unknown): unknown {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as {type?: unknown}).type
        : undefined;
}

function requireString(value: unknown, message: string): asserts value is string {
    if (typeof value !== "string") {
        corrupt(message);
    }
}

function requireFiniteNumber(value: unknown, message: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        corrupt(message);
    }
}

function requireExactKeys(value: Record<string, unknown>, allowed: Set<string>, message: string): void {
    const undeclared = Object.keys(value).filter((key) => !allowed.has(key)).sort();
    if (undeclared.length > 0) {
        corrupt(`${message}（${undeclared.join(", ")}）`);
    }
}

/** 校验 Pi Usage；assistant 必填，toolResult 可选。 */
function parseUsage(value: unknown, owner: string): void {
    const usage = objectValue(value, `${owner} 缺少 usage。`);
    requireExactKeys(usage, USAGE_KEYS, `${owner} usage 包含未声明字段。`);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
        requireFiniteNumber(usage[key], `${owner} usage.${key} 非法。`);
    }
    if (usage.cacheWrite1h !== undefined) {
        requireFiniteNumber(usage.cacheWrite1h, `${owner} usage.cacheWrite1h 非法。`);
    }
    if (usage.reasoning !== undefined) {
        requireFiniteNumber(usage.reasoning, `${owner} usage.reasoning 非法。`);
    }
    const cost = objectValue(usage.cost, `${owner} usage.cost 非法。`);
    requireExactKeys(cost, COST_KEYS, `${owner} usage.cost 包含未声明字段。`);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
        requireFiniteNumber(cost[key], `${owner} usage.cost.${key} 非法。`);
    }
}

/** 校验 Pi DeferredHandle。 */
function parseDeferredHandle(value: unknown): void {
    const deferred = objectValue(value, "Stored assistant deferred 非法。");
    requireExactKeys(deferred, DEFERRED_HANDLE_KEYS, "Stored assistant deferred 包含未声明字段。");
    for (const key of ["provider", "modelId", "api", "id"] as const) {
        requireString(deferred[key], `Stored assistant deferred.${key} 非法。`);
    }
    if (deferred.expiresAt !== undefined) {
        requireFiniteNumber(deferred.expiresAt, "Stored assistant deferred.expiresAt 非法。");
    }
    if (deferred.pollAfterMs !== undefined) {
        requireFiniteNumber(deferred.pollAfterMs, "Stored assistant deferred.pollAfterMs 非法。");
    }
    if (deferred.data !== undefined && !isJsonValue(deferred.data)) {
        corrupt("Stored assistant deferred.data 不是 JSON value。");
    }
}

/** 校验 Pi NestedToolCalls。 */
function parseNestedToolCalls(value: unknown): void {
    const nested = objectValue(value, "Stored toolResult nestedCalls 非法。");
    requireExactKeys(nested, NESTED_TOOL_CALLS_KEYS, "Stored toolResult nestedCalls 包含未声明字段。");
    if (!Array.isArray(nested.calls)) {
        corrupt("Stored toolResult nestedCalls.calls 必须是数组。");
    }
    if (typeof nested.complete !== "boolean") {
        corrupt("Stored toolResult nestedCalls.complete 非法。");
    }
    for (const entry of nested.calls) {
        const call = objectValue(entry, "Stored toolResult nestedCalls.calls 项必须是对象。");
        requireExactKeys(call, NESTED_TOOL_CALL_RECORD_KEYS, "Stored toolResult nestedCalls.calls 项包含未声明字段。");
        requireString(call.id, "Stored toolResult nestedCalls.calls.id 非法。");
        requireString(call.name, "Stored toolResult nestedCalls.calls.name 非法。");
        if (typeof call.status !== "string" || !NESTED_TOOL_CALL_STATUSES.has(call.status)) {
            corrupt("Stored toolResult nestedCalls.calls.status 非法。");
        }
        if (call.arguments !== undefined && !isJsonObject(call.arguments)) {
            corrupt("Stored toolResult nestedCalls.calls.arguments 非法。");
        }
        if (call.argumentsBytes !== undefined) {
            requireFiniteNumber(call.argumentsBytes, "Stored toolResult nestedCalls.calls.argumentsBytes 非法。");
        }
        if (call.durationMs !== undefined) {
            requireFiniteNumber(call.durationMs, "Stored toolResult nestedCalls.calls.durationMs 非法。");
        }
        if (call.error !== undefined && typeof call.error !== "string") {
            corrupt("Stored toolResult nestedCalls.calls.error 非法。");
        }
    }
}

function isJsonObject(value: unknown): value is {[key: string]: JsonValue} {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

function isJsonValue(value: unknown, ancestors: Set<object> = new Set()): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        if (ancestors.has(value)) {
            return false;
        }
        ancestors.add(value);
        const valid = value.every((item) => isJsonValue(item, ancestors));
        ancestors.delete(value);
        return valid;
    }
    if (value && typeof value === "object") {
        const prototype = Object.getPrototypeOf(value) as object | null;
        if ((prototype !== Object.prototype && prototype !== null) || ancestors.has(value)) {
            return false;
        }
        ancestors.add(value);
        const valid = Object.values(value).every((item) => isJsonValue(item, ancestors));
        ancestors.delete(value);
        return valid;
    }
    return false;
}

function corrupt(message: string): never {
    throw new StoredMessageInvariantError("corrupt", message);
}
