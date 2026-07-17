import type {AgentChatAttachmentDto, PublicAttachmentDto} from "nbook/shared/dto/agent-public-event.dto";

/** Chat Flow 可展示的附件定位信息。contentIndex 必须保持 stored content 的原始索引。 */
export type AgentAttachmentDisplay = {
    contentIndex: number;
    attachment: PublicAttachmentDto;
};

/** 将 durable entry 的附件 locator 转成受 session/entry/content index 约束的读取地址。 */
export const agentAttachmentUrl = (
    sessionId: number | null | undefined,
    entryId: string | null | undefined,
    contentIndex: number,
): string | null => {
    if (
        sessionId === null
        || sessionId === undefined
        || !Number.isSafeInteger(sessionId)
        || !entryId
        || !Number.isSafeInteger(contentIndex)
        || contentIndex < 0
    ) {
        return null;
    }
    return `/api/agent/sessions/${encodeURIComponent(String(sessionId))}/entries/${encodeURIComponent(entryId)}/attachments/${String(contentIndex)}`;
};

/** 复制公开附件 locator，避免前端在消息状态中保留服务端 DTO 的可变引用。 */
export const copyAgentAttachments = (attachments: AgentChatAttachmentDto[] | undefined): AgentAttachmentDisplay[] => {
    return (attachments ?? []).map((item) => ({
        contentIndex: item.contentIndex,
        attachment: {...item.attachment},
    }));
};
