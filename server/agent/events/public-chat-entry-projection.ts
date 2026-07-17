import type {Message, ToolCall, ToolResultMessage} from "@earendil-works/pi-ai";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {
    CHAT_ENTRY_MAX_BLOCKS,
    CHAT_ENTRY_PREVIEW_BYTES,
    CHAT_ENTRY_SERIALIZED_TEXT_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import {
    budgetText,
    createPublicProjectionBudget,
    projectPublicAttachment,
    projectPublicToolArgs,
    projectPublicToolResult,
    textPreview,
} from "nbook/server/agent/events/public-tool-projection";
import {
    PUBLIC_ASSISTANT_TEXT_BYTES,
    PUBLIC_ASSISTANT_TOOL_CALLS,
    PUBLIC_TOOL_ARGS_TEXT_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import type {SessionEntry} from "nbook/server/agent/session/types";
import type {AgentChatEntryDto, AgentChatUserEntryDto, PublicTextPreviewDto} from "nbook/shared/dto/agent-public-event.dto";

export type AgentChatEntryProjectionContext = {
    /** assistant entry 所属 invocation；非 assistant 时忽略。 */
    invocationId?: string;
};

/**
 * 将 append-only 账本 entry 投影为 Chat Flow 的有界公开 entry。
 */
export function projectAgentChatEntry(
    entry: SessionEntry,
    context: AgentChatEntryProjectionContext = {},
): AgentChatEntryDto | null {
    if (entry.type === "message") {
        return projectMessageEntry(entry, context);
    }
    if (entry.type === "custom_message") {
        const content = customMessageText(entry.message);
        const reminder = content.includes("<system-reminder>")
            || customMessageKind(entry.message) === "system-reminder"
            || customMessageKind(entry.message) === "reminder";
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: reminder ? "reminder" : "custom",
            label: reminder ? "System Reminder" : `Custom: ${customMessageKind(entry.message)}`,
            content: textPreview(content, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "compaction") {
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: "compaction",
            label: "Compaction",
            content: textPreview(entry.summary, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "branch_summary") {
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "system",
            source: "branch_summary",
            label: "Branch Summary",
            content: textPreview(entry.summary, CHAT_ENTRY_PREVIEW_BYTES),
        };
    }
    if (entry.type === "invocation_lifecycle" && entry.status === "error") {
        const message = entry.errorInfo?.message?.trim() || entry.error?.trim();
        if (!message) {
            return null;
        }
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "invocation_error",
            invocationId: entry.invocationId,
            message: textPreview(message, CHAT_ENTRY_PREVIEW_BYTES),
            phase: entry.errorInfo?.phase ?? "unknown",
            ...(entry.errorInfo?.retryable === undefined ? {} : {retryable: entry.errorInfo.retryable}),
            ...(entry.errorInfo?.code ? {code: entry.errorInfo.code} : {}),
        };
    }
    return null;
}

/**
 * 投影标准 message entry。
 */
function projectMessageEntry(
    entry: Extract<SessionEntry, {type: "message"}>,
    context: AgentChatEntryProjectionContext,
): AgentChatEntryDto | null {
    const message = entry.message;
    if (message.role === "user") {
        const content = messageText(message);
        const steer = steerText(content);
        if (entry.origin !== "prompt" && steer === null) {
            return null;
        }
        const publicContent = projectUserContent(message, steer);
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: "user",
            ...publicContent,
            intent: steer === null ? "normal" : "steer",
        };
    }
    if (message.role === "assistant") {
        const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        const thinking = message.content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("");
        const textBudget = createPublicProjectionBudget(PUBLIC_ASSISTANT_TEXT_BYTES);
        const error = message.errorMessage ? budgetText(message.errorMessage, textBudget, 8 * 1024) : undefined;
        const content = budgetText(text, textBudget, 48 * 1024);
        const thinkingPreview = budgetText(thinking, textBudget);
        const rawToolCalls = message.content
            .map((block, index) => ({block, index}))
            .filter((item): item is {block: ToolCall; index: number} => item.block.type === "toolCall");
        const toolArgsBudget = createPublicProjectionBudget(PUBLIC_TOOL_ARGS_TEXT_BYTES);
        const toolCalls = rawToolCalls
            .slice(0, PUBLIC_ASSISTANT_TOOL_CALLS)
            .map(({block, index}) => ({
                id: block.id,
                index,
                name: textPreview(block.name, 512).preview,
                args: projectPublicToolArgs(block.name, block.arguments, toolArgsBudget),
            }));
        return {
            id: textPreview(entry.id, 512).preview,
            timestamp: entry.timestamp,
            type: "assistant",
            ...(context.invocationId ? {invocationId: context.invocationId} : {}),
            content,
            thinking: thinkingPreview,
            ...(error ? {error} : {}),
            status: entry.status ?? "done",
            model: textPreview(message.responseModel ?? message.model, 1024).preview,
            usage: {
                ...message.usage,
                cost: {...message.usage.cost},
            },
            toolCalls,
            omittedToolCalls: Math.max(0, rawToolCalls.length - toolCalls.length),
        };
    }
    if (message.role !== "toolResult") {
        return null;
    }
    return projectToolResultEntry(entry.id, entry.timestamp, message);
}

/** 投影 user message 的唯一保序公开内容；steer envelope 的文本使用解包后正文。 */
function projectUserContent(
    message: Message | StoredAgentMessage,
    steer: string | null,
): Pick<AgentChatUserEntryDto, "blocks" | "omittedBlocks" | "textSummary"> {
    const textBudget = {
        remainingRawBytes: CHAT_ENTRY_PREVIEW_BYTES,
        remainingSerializedBytes: CHAT_ENTRY_SERIALIZED_TEXT_BYTES,
    };
    if (steer !== null) {
        const text = budgetUserText(steer, textBudget);
        const blocks: AgentChatUserEntryDto["blocks"] = [
            {type: "text" as const, contentIndex: 0, content: text},
            ...messageAttachmentBlocks(message),
        ].slice(0, CHAT_ENTRY_MAX_BLOCKS);
        const rawBlocks = Array.isArray(message.content) ? message.content.length : 1;
        return {
            blocks,
            omittedBlocks: Math.max(0, rawBlocks - blocks.length),
            textSummary: {bytes: text.bytes, omitted: text.omitted},
        };
    }
    if (typeof message.content === "string") {
        const content = budgetUserText(message.content, textBudget);
        return {
            blocks: [{type: "text", contentIndex: 0, content}],
            omittedBlocks: 0,
            textSummary: {bytes: content.bytes, omitted: content.omitted},
        };
    }
    const blocks: AgentChatUserEntryDto["blocks"] = [];
    let textBytes = 0;
    let textBlocks = 0;
    let textOmitted = false;
    message.content.forEach((block, contentIndex) => {
        if (block.type === "text") {
            if (textBlocks > 0) {
                textBytes += 1;
            }
            textBlocks += 1;
            textBytes += Buffer.byteLength(block.text, "utf8");
            if (contentIndex >= CHAT_ENTRY_MAX_BLOCKS) {
                textOmitted = textOmitted || block.text.length > 0;
                return;
            }
            const content = budgetUserText(block.text, textBudget);
            textOmitted = textOmitted || content.omitted;
            blocks.push({type: "text", contentIndex, content});
            return;
        }
        if (contentIndex >= CHAT_ENTRY_MAX_BLOCKS) {
            return;
        }
        if (block && typeof block === "object" && "type" in block && block.type === "attachment") {
            const record = block as unknown as {attachment?: unknown; name?: unknown};
            const attachment = projectPublicAttachment(record.attachment, record.name);
            if (attachment) {
                blocks.push({type: "attachment", contentIndex, attachment});
            }
        }
    });
    return {
        blocks,
        omittedBlocks: Math.max(0, message.content.length - blocks.length),
        textSummary: {bytes: textBytes, omitted: textOmitted},
    };
}

type UserTextBudget = {
    remainingRawBytes: number;
    remainingSerializedBytes: number;
};

/**
 * 同时约束正文 UTF-8 大小与 JSON string 转义后的大小。
 * 控制字符会在 stringify 时扩张，不能只按原始 UTF-8 预算判断 event 大小。
 */
function budgetUserText(value: string, budget: UserTextBudget): PublicTextPreviewDto {
    const raw = textPreview(value, budget.remainingRawBytes);
    let preview = raw.preview;
    if (jsonStringBytes(preview) > budget.remainingSerializedBytes) {
        let low = 0;
        let high = preview.length;
        while (low < high) {
            let middle = Math.ceil((low + high) / 2);
            const lastCodeUnit = preview.charCodeAt(middle - 1);
            if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
                middle -= 1;
            }
            if (jsonStringBytes(preview.slice(0, middle)) <= budget.remainingSerializedBytes) {
                low = Math.max(low + 1, middle);
            } else {
                high = Math.max(0, middle - 1);
            }
        }
        let safeLength = Math.min(low, preview.length);
        while (safeLength > 0 && jsonStringBytes(preview.slice(0, safeLength)) > budget.remainingSerializedBytes) {
            safeLength -= 1;
        }
        const lastCodeUnit = preview.charCodeAt(safeLength - 1);
        if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
            safeLength -= 1;
        }
        preview = preview.slice(0, Math.max(0, safeLength));
    }
    const rawPreviewBytes = Buffer.byteLength(preview, "utf8");
    const serializedPreviewBytes = jsonStringBytes(preview);
    budget.remainingRawBytes = Math.max(0, budget.remainingRawBytes - rawPreviewBytes);
    budget.remainingSerializedBytes = Math.max(0, budget.remainingSerializedBytes - serializedPreviewBytes);
    return {
        preview,
        bytes: raw.bytes,
        omitted: raw.omitted || preview.length < raw.preview.length,
    };
}

/** 返回 JSON string 内容本身的 UTF-8 bytes，不计外围引号。 */
function jsonStringBytes(value: string): number {
    return Math.max(0, Buffer.byteLength(JSON.stringify(value), "utf8") - 2);
}

/** 投影 steer message 的 attachment blocks，并保留原 stored content index。 */
function messageAttachmentBlocks(message: Message | StoredAgentMessage): AgentChatUserEntryDto["blocks"] {
    if (!Array.isArray(message.content)) {
        return [];
    }
    return message.content.flatMap((block, contentIndex) => {
        if (block === null || typeof block !== "object" || !("type" in block) || block.type !== "attachment") {
            return [];
        }
        const record = block as unknown as {attachment?: unknown; name?: unknown};
        const attachment = projectPublicAttachment(record.attachment, record.name);
        return attachment ? [{type: "attachment" as const, contentIndex, attachment}] : [];
    });
}

/**
 * 投影 durable tool result。
 */
function projectToolResultEntry(
    id: string,
    timestamp: number,
    message: ToolResultMessage | Extract<StoredAgentMessage, {role: "toolResult"}>,
): AgentChatEntryDto {
    return {
        id,
        timestamp,
        type: "tool_result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        result: projectPublicToolResult(message.toolName, {
            content: message.content,
            details: message.details,
        }),
        isError: message.isError,
    };
}

/**
 * 标准 user/toolResult 文本提取，不读取图片 data。
 */
function messageText(message: StoredAgentMessage): string {
    if (typeof message.content === "string") {
        return message.content;
    }
    return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

/**
 * 提取 steer envelope；普通文本返回 null。
 */
function steerText(value: string): string | null {
    const match = /^<user_steer>\n?([\s\S]*?)\n?<\/user_steer>$/.exec(value.trim());
    return match?.[1] ?? null;
}

/**
 * custom message 只读取受支持的文本字段，禁止 JSON.stringify 任意对象。
 */
function customMessageText(message: unknown): string {
    if (message === null || typeof message !== "object") {
        return "";
    }
    const record = message as Record<string, unknown>;
    if (typeof record.content === "string") {
        return record.content;
    }
    if (!Array.isArray(record.content)) {
        return "";
    }
    return record.content
        .filter((block): block is {type: "text"; text: string} => {
            return block !== null
                && typeof block === "object"
                && "type" in block
                && block.type === "text"
                && "text" in block
                && typeof block.text === "string";
        })
        .map((block) => block.text)
        .join("\n");
}

/**
 * custom message 的公开类别。
 */
function customMessageKind(message: unknown): string {
    if (message === null || typeof message !== "object") {
        return "custom";
    }
    const record = message as Record<string, unknown>;
    if (typeof record.customType === "string") {
        return textPreview(record.customType, 256).preview || "custom";
    }
    if (typeof record.role === "string") {
        return textPreview(record.role, 256).preview || "custom";
    }
    return "custom";
}
