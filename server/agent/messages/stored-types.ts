import type {AssistantMessage, JsonValue, TextContent, UserMessage} from "nbook/server/agent/messages/types";
import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";

/**
 * Session truth 中的附件内容块。文件名描述本次使用场景，不参与 blob identity。
 */
export type StoredAttachmentContent = {
    type: "attachment";
    attachment: AttachmentRef;
    /** 用户上传名或工具读取文件名；未知时为空。 */
    name?: string;
};

/** Session truth 允许持久化的用户/工具正文内容。 */
export type StoredContent = TextContent | StoredAttachmentContent;

/** 用户消息的持久化形态；禁止 Pi ImageContent。 */
export type StoredUserMessage = Omit<UserMessage, "content"> & {
    content: string | StoredContent[];
};

/** 工具结果的持久化形态；details 必须是 JSON value。 */
export type StoredToolResultMessage = {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: StoredContent[];
    /** 工具没有结构化 details 时为空。 */
    details?: JsonValue;
    isError: boolean;
    timestamp: number;
};

/** JSONL、RunFrame、queue、hook 与 sidecar 共用的 Agent 消息真相。 */
export type StoredAgentMessage = StoredUserMessage | AssistantMessage | StoredToolResultMessage;

/** invocation/steer/follow-up 在 admission 后使用的引用态输入。 */
export type StoredAgentUserMessageInput = {
    text: string;
    attachments?: StoredAttachmentContent[];
};

/** follow-up queue 中一条已经完成 attachment admission 的调用输入。 */
export type StoredFollowUpQueueItem = {
    id: string;
    kind: "followup";
    message?: StoredAgentUserMessageInput;
    input?: JsonValue;
    createdAt: number;
};

/** follow-up 暂停原因；只在 paused 状态存在。 */
export type StoredFollowUpQueuePause = {
    invocationId: string;
    reason: "error" | "aborted" | "interrupted";
};

/** 持久化在 session custom state 中的 follow-up queue 真相。 */
export type StoredFollowUpQueueState =
    | {
        status: "ready";
        items: StoredFollowUpQueueItem[];
    }
    | {
        status: "paused";
        pausedBy: StoredFollowUpQueuePause;
        items: StoredFollowUpQueueItem[];
    };

/** 判断 content block 是否为 stored attachment。 */
export function isStoredAttachmentContent(value: StoredContent): value is StoredAttachmentContent {
    return value.type === "attachment";
}
