import {estimateContextTokens as estimatePiContextTokens, estimateMessageTokens as estimatePiTokens} from "@earendil-works/pi-ai/utils/estimate";
import {storedMessageForEstimate, type StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";

/**
 * stored message 的 token 估算入口。
 *
 * 单独成模块的原因：估算器是 `stored-message-presentation` 中唯一的
 * Pi 值导入，而 presentation 会进 profile artifact 依赖图；
 * 拆开后 artifact 不再拖入全部 Provider SDK。Pi 1.3 起估算器在 pi-ai/utils/estimate。
 */

/** 不读取 blob 的单消息 token 估算。 */
export function estimateStoredMessageTokens(message: StoredMessageLike): number {
    return estimatePiTokens(storedMessageForEstimate(message));
}

/**
 * 不读取 blob 的上下文 token 估算。
 * 保留 Pi 对最近一次 assistant usage 的处理语义，避免 compaction 与主 turn 出现两套预算。
 */
export function estimateStoredContextTokens(messages: readonly StoredMessageLike[]): ReturnType<typeof estimatePiContextTokens> {
    return estimatePiContextTokens(messages.map(storedMessageForEstimate));
}
