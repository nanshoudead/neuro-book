import type {JsonValue} from "nbook/server/agent/messages/types";
import type {StoredAgentUserMessageInput} from "nbook/server/agent/messages/stored-types";
import type {AgentQueuedMessageDto, AgentQueuedMessageListDto} from "nbook/shared/dto/agent-session.dto";
import {
    budgetText,
    createPublicProjectionBudget,
    type PublicProjectionBudget,
    valuePreviewWithBudget,
} from "nbook/server/agent/events/public-tool-projection";

const PUBLIC_QUEUE_ITEMS = 64;
const PUBLIC_QUEUE_TEXT_BYTES = 64 * 1024;
const PUBLIC_QUEUE_ITEM_BYTES = 8 * 1024;
const PUBLIC_QUEUE_IMAGES = 8;

/** Harness 内部队列真相；图片和 payload 只在执行路径中使用。 */
export type AgentQueuedInvocationTruth = {
    id: string;
    kind: "steer" | "followup";
    message?: StoredAgentUserMessageInput;
    input?: JsonValue;
    createdAt: number;
};

/** 投影单个 queue delta event。 */
export function projectQueuedMessage(
    item: AgentQueuedInvocationTruth,
    budget: PublicProjectionBudget = createPublicProjectionBudget(PUBLIC_QUEUE_ITEM_BYTES),
): AgentQueuedMessageDto {
    const images = item.message?.attachments ?? [];
    return {
        id: item.id,
        kind: item.kind,
        ...(item.message?.text ? {text: budgetText(item.message.text, budget, 2 * 1024)} : {}),
        images: images.slice(0, PUBLIC_QUEUE_IMAGES).map((image) => ({
            mimeType: budgetText(image.attachment.mimeType, budget, 256).preview || "application/octet-stream",
            dataBytes: image.attachment.bytes,
            dataOmitted: true as const,
        })),
        omittedImages: Math.max(0, images.length - PUBLIC_QUEUE_IMAGES),
        ...(item.input === undefined ? {} : {input: valuePreviewWithBudget(item.input, budget)}),
        createdAt: item.createdAt,
    };
}

/** recovery 只公开最早 64 项，并让全部 item 共用 64 KiB 文本预算。 */
export function projectQueuedMessages(items: AgentQueuedInvocationTruth[]): AgentQueuedMessageListDto {
    const visible = items.slice(0, PUBLIC_QUEUE_ITEMS);
    const budget = createPublicProjectionBudget(PUBLIC_QUEUE_TEXT_BYTES);
    return {
        items: visible.map((item) => projectQueuedMessage(item, budget)),
        omittedItems: Math.max(0, items.length - visible.length),
    };
}
