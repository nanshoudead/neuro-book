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
    /** 对话中途改阅读位置写进日志的提醒（t25）：不交给适配器（它会当成提问或复查消息），自己合成系统消息，放在所在那一轮的末尾。 */
    const reminders: MessageView[][] = bounds.map(() => []);
    /** 先扣住的用户消息条目：下一条若是紧跟它的 `qa.position` 元数据，它就是提醒；不是就原样交给适配器。 */
    let held: {entry: unknown; text: string | null} | null = null;

    /** 这条条目属于哪一轮：起点不大于它的 seq 的最后一轮；没有 seq 的交给第一份（适配器会把它记成问题条目）。 */
    function partOf(entry: unknown): HarnessTranscript {
        const seq = typeof entry === "object" && entry !== null ? (entry as {seq?: unknown}).seq : undefined;
        if (typeof seq !== "number") return parts[0]!;
        let index = 0;
        while (index + 1 < bounds.length && bounds[index + 1]! <= seq) index += 1;
        return parts[index]!;
    }

    function release(): void {
        if (held === null) return;
        partOf(held.entry).applyLogEntry(held.entry);
        held = null;
    }

    function indexOfPart(entry: unknown): number {
        return parts.indexOf(partOf(entry));
    }

    return {
        applyLogEntry(entry) {
            const kind = kindOf(entry);
            if (kind === "meta" && held !== null && metaKey(entry) === POSITION_META_KEY && seqOf(entry) === seqOf(held.entry)! + 1 && held.text !== null) {
                // 提醒的识别靠这条紧跟的元数据（引擎写的），不看用户消息的文字：用户可以把同样的标签当问题提交。
                const seq = seqOf(held.entry)!;
                reminders[indexOfPart(held.entry)]!.push({kind: "system", id: `h${seq}`, timestamp: timestampOf(held.entry), source: "reminder", label: "系统提醒", text: held.text});
                held = null;
                return;
            }
            release();
            if (kind === "agent_message" && userTextOf(entry) !== null) {
                held = {entry, text: reminderBody(userTextOf(entry)!)};
                return;
            }
            if (kind === "meta" && metaKey(entry) === POSITION_META_KEY) return;
            partOf(entry).applyLogEntry(entry);
        },
        applyEvent: event => {
            release();
            parts.at(-1)!.applyEvent(event);
        },
        // 消息对象是各份交出的原对象，视图按对象判断一轮要不要重算（turns.ts 的缓存也按它）。
        messages: () => {
            release();
            return parts.flatMap((part, index) => [...part.messages(), ...reminders[index]!]);
        },
    };
}

/** 引擎写在提醒消息后面的 `meta` 条目的键（qa/engine.ts 的 `POSITION_META_KEY`；这里不导入引擎，网页不带服务端代码）。 */
const POSITION_META_KEY = "qa.position";
const REMINDER = /^<system-reminder>\n([^]*)\n<\/system-reminder>$/u;

const kindOf = (entry: unknown): string | null => (typeof entry === "object" && entry !== null && typeof (entry as {kind?: unknown}).kind === "string" ? (entry as {kind: string}).kind : null);
const seqOf = (entry: unknown): number | null => (typeof entry === "object" && entry !== null && typeof (entry as {seq?: unknown}).seq === "number" ? (entry as {seq: number}).seq : null);
const metaKey = (entry: unknown): string | null => (typeof entry === "object" && entry !== null && typeof (entry as {key?: unknown}).key === "string" ? (entry as {key: string}).key : null);
const timestampOf = (entry: unknown): number => {
    const at = typeof entry === "object" && entry !== null ? (entry as {at?: unknown}).at : undefined;
    return typeof at === "string" ? Date.parse(at) || 0 : 0;
};

/** 用户消息条目的文字（OMP 的用户消息：content 是字符串或文字块）；不是用户消息为 null。 */
function userTextOf(entry: unknown): string | null {
    const message = (entry as {message?: {role?: unknown; content?: unknown}}).message;
    if (typeof message !== "object" || message === null || message.role !== "user") return null;
    const content = message.content;
    if (typeof content === "string") return content;
    return Array.isArray(content) ? content.map(block => (typeof block === "object" && block !== null && typeof (block as {text?: unknown}).text === "string" ? (block as {text: string}).text : "")).join("") : "";
}

/** 整条文字恰是 `<system-reminder>` 包着的提醒时给出里面的话；否则 null（只用来在有紧跟的元数据时显示，不单独判身份）。 */
function reminderBody(text: string): string | null {
    return REMINDER.exec(text)?.[1] ?? null;
}
