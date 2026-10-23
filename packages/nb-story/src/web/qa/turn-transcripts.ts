/**
 * 按轮分开的转录：每一轮（记录里各轮的 `logFrom`，加上运行中这一轮的）各用一份 nb-agent-ui 的适配器，日志条目按 seq
 * 落到它所在的那一轮，事件只给最后一轮（运行中的那一轮）。
 *
 * 为什么不一份到底：适配器按日志顺序合成消息，没有“轮”的概念。写用户提问之前就结束的一轮（开始前就停了、缺密钥）
 * 在日志里只有一条 `run_end`，一份适配器会把它当成上一条助手回复的结束，把上一轮已经答完的回复改成“已停止”、把
 * 错误接在上一轮后面。每轮一份时，这条 `run_end` 只在自己那一轮里合成一条“已停止”或错误，提问由 `turns.ts` 按记录补上。
 *
 * 旧记录没有 `logFrom`，只能一份到底（接受旧形状里的错位，只显示）。
 */

import {createHarnessTranscript, type HarnessTranscript, type MessageView} from "@notnotype/nb-agent-ui";

export interface TurnTranscripts {
    applyLogEntry(entry: unknown): void;
    /** 运行中的事件：只属于最后一轮。 */
    applyEvent(event: unknown): void;
    messages(): readonly MessageView[];
}

/** `starts` 是各轮在日志里的起点（升序，第一轮是 1）；为 null 时（旧记录）一份到底。 */
export function createTurnTranscripts(starts: readonly number[] | null): TurnTranscripts {
    const bounds = starts === null || starts.length === 0 ? [1] : [...starts];
    const parts: HarnessTranscript[] = bounds.map(() => createHarnessTranscript());

    /** 这条条目属于哪一轮：起点不大于它的 seq 的最后一轮；没有 seq 的交给第一份（适配器会把它记成问题条目）。 */
    function partOf(entry: unknown): HarnessTranscript {
        const seq = typeof entry === "object" && entry !== null ? (entry as {seq?: unknown}).seq : undefined;
        if (typeof seq !== "number") return parts[0]!;
        let index = 0;
        while (index + 1 < bounds.length && bounds[index + 1]! <= seq) index += 1;
        return parts[index]!;
    }

    return {
        applyLogEntry: entry => partOf(entry).applyLogEntry(entry),
        applyEvent: event => parts.at(-1)!.applyEvent(event),
        // 消息对象是各份交出的原对象，视图按对象判断一轮要不要重算（turns.ts 的缓存也按它）。
        messages: () => parts.flatMap(part => part.messages()),
    };
}
