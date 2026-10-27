/**
 * 发给模型的上下文里，相邻的用户消息合并成一条。
 *
 * 为什么：会话里的“位置提醒”与随后的问题是两条独立持久的用户消息（nb-story 的问答，docs/specs/story/qa.md 输出 53），
 * 而有的端点（DeepSeek 的 reasoner、个别网关）拒绝连续的 user 消息，OMP 各传输层都原样转发。所以日志与界面保持两条，
 * 只在发请求前合并；合并不改会话里的消息。文字块之间用空行隔开，非文字块（图片等）按原顺序保留。
 */

type Block = {type?: string; text?: string; [key: string]: unknown};
type MessageLike = {role: string; content?: unknown; [key: string]: unknown};

function blocksOf(content: unknown): Block[] {
    if (typeof content === "string") return [{type: "text", text: content}];
    return Array.isArray(content) ? (content as Block[]) : [];
}

export function mergeAdjacentUserMessages<T extends {role: string}>(messages: readonly T[]): T[] {
    const merged: T[] = [];
    for (const message of messages) {
        const last = merged.at(-1);
        if (message.role !== "user" || last?.role !== "user") {
            merged.push(message);
            continue;
        }
        const previous = last as unknown as MessageLike;
        const current = message as unknown as MessageLike;
        const blocks = [...blocksOf(previous.content)];
        for (const block of blocksOf(current.content)) {
            const tail = blocks.at(-1);
            if (block.type === "text" && tail?.type === "text") blocks[blocks.length - 1] = {...tail, text: `${tail.text ?? ""}\n\n${block.text ?? ""}`};
            else blocks.push(block);
        }
        merged[merged.length - 1] = {...current, content: blocks, timestamp: previous.timestamp ?? current.timestamp} as unknown as T;
    }
    return merged;
}
