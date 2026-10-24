/**
 * 对话视图要的消息：在适配器（nb-agent-ui 的 `createHarnessTranscript`）合成的消息上，按记录的各轮补上分轮要的东西
 * （docs/specs/story/viewer.md 的问答页）。
 *
 * 视图只在用户提问处开新的一轮。有的轮在写用户消息之前就结束了（缺密钥、开始前就停了），日志里只有一条运行结束，
 * 合成出来是一条错误或“已停止”，会接到上一轮后面、把上一轮标成出错。所以按记录每轮的 `logFrom`（这一轮在日志里的
 * 起点；消息来自日志的哪一条按适配器的 `logSeqOf`）把消息分到各轮，某一轮开头不是用户提问时用记录里的问题补一条。运行中、提问
 * 还没写进日志时也先放一条（乐观的提问，`delivery: "pending"`）。
 *
 * 每一轮的提问 id 固定为 `q:<对话 id>:<轮号>`（包括日志里真的那条，换成同一个 id）：乐观的、补的与真的前后是同一个
 * id，视图按 id 复用这一轮的组件，展开状态不丢。
 *
 * 附注：每一轮最后一条有文字的助手消息挂“没核实的出处”（`nb-story.unverified-refs`）。
 *
 * 出处复查（docs/specs/story/qa.md 输出 39）：一轮里第一条提问之后的用户消息是引擎写给模型的复查消息（nb-story 不发
 * steer，同一轮里不会有别的用户消息）。它换成过程里的一行系统消息，不让视图在这里开新的一轮。
 *
 * 换 id、补消息、挂附注都换成新对象，并按原对象缓存（调用方给 `cache`）：视图按消息对象是否相同决定一轮要不要重算，
 * 打节拍时原对象原样交回。
 */

import {logSeqOf, type MessageView, type SystemMessageView, type UserMessageView} from "@notnotype/nb-agent-ui";

/** 记录里一轮在这里用到的部分。 */
export interface TurnInfo {
    readonly question: string;
    /** 这一轮在日志里的起点；旧记录没有。 */
    readonly logFrom?: number;
    /** 没核实的出处（文字回复）；没有时为空。 */
    readonly unverifiedRefs?: readonly string[];
    /** ISO 8601；补提问时作时间。 */
    readonly startedAt: string;
}

export interface ComposeInput {
    readonly conversationId: string;
    /** 记录里已有的各轮，按顺序。 */
    readonly turns: readonly TurnInfo[];
    /** 运行中（或刚结束、记录还没读回）的这一轮；没有时为 null。 */
    readonly running: (TurnInfo & {readonly logFrom: number}) | null;
}

export const UNVERIFIED_REFS = "nb-story.unverified-refs";

/** 按原对象缓存换过的对象。键里带上换法（同一条消息可能既换 id 又挂附注）。 */
export type MessageCache = WeakMap<MessageView, Map<string, MessageView>>;

export function createMessageCache(): MessageCache {
    return new WeakMap();
}

function cached(cache: MessageCache, message: MessageView, key: string, make: () => MessageView): MessageView {
    let byKey = cache.get(message);
    if (byKey === undefined) {
        byKey = new Map();
        cache.set(message, byKey);
    }
    let made = byKey.get(key);
    if (made === undefined) {
        made = make();
        byKey.set(key, made);
    }
    return made;
}


const isQuestion = (message: MessageView): message is UserMessageView => message.kind === "user" && message.intent === "normal";

export function questionId(conversationId: string, turn: number): string {
    return `q:${conversationId}:${turn}`;
}

/** 补出来的提问（日志里没有这一轮的用户消息）；运行中还没写进日志的是乐观的（`delivery: "pending"`）。 */
function syntheticQuestion(conversationId: string, turn: number, info: TurnInfo, pending: boolean): UserMessageView {
    return {
        kind: "user",
        id: questionId(conversationId, turn),
        timestamp: Date.parse(info.startedAt) || 0,
        intent: "normal",
        blocks: [{kind: "text", text: info.question}],
        contentOmitted: false,
        ...(pending ? {delivery: "pending" as const} : {}),
    };
}

/**
 * 复查消息里没读过的出处（引擎的写法见 src/qa/rules.ts 的 `recheckMessage`：“……读过的段落：37.8、38.1。……”）；
 * 认不出时为空。
 */
function recheckRefs(message: UserMessageView): string[] {
    const text = message.blocks.map(block => (block.kind === "text" ? block.text : "")).join("");
    const listed = /读过的段落：([^。]+)。/u.exec(text)?.[1];
    return listed === undefined ? [] : listed.split("、").filter(ref => ref !== "");
}

function recheckLine(message: UserMessageView): SystemMessageView {
    const refs = recheckRefs(message);
    // 标签已经写了“出处检查”，正文不再重复。
    return {kind: "system", id: message.id, timestamp: message.timestamp, source: "reminder", label: "出处检查", text: refs.length === 0 ? "有没读过的出处，已让模型重写" : `${refs.join("、")} 没读过，已让模型重写`};
}

export function composeMessages(messages: readonly MessageView[], input: ComposeInput, cache: MessageCache): MessageView[] {
    const turns = input.running === null ? input.turns : [...input.turns, input.running];
    // 旧记录（没有 logFrom）不能按日志位置分轮：原样交出，接受旧形状里的错位。
    if (turns.length === 0 || turns.some(turn => turn.logFrom === undefined)) return [...messages];
    const starts = turns.map(turn => turn.logFrom!);
    const turnOf = (seq: number): number => {
        let index = 0;
        while (index + 1 < starts.length && seq >= starts[index + 1]!) index += 1;
        return index;
    };
    const groups: MessageView[][] = turns.map(() => []);
    for (const message of messages) {
        const seq = logSeqOf(message);
        // 运行中的临时消息（没有 seq）属于最后一轮。
        groups[seq === null ? turns.length - 1 : turnOf(seq)]!.push(message);
    }
    const result: MessageView[] = [];
    groups.forEach((group, index) => {
        const turn = index + 1;
        const info = turns[index]!;
        const pending = input.running !== null && index === turns.length - 1;
        const id = questionId(input.conversationId, turn);
        const firstQuestion = group.findIndex(isQuestion);
        if (firstQuestion === 0) {
            const question = group[0]!;
            group[0] = question.id === id ? question : cached(cache, question, `id:${id}`, () => ({...question, id}));
        } else {
            group.unshift(syntheticQuestion(input.conversationId, turn, info, pending && firstQuestion < 0));
        }
        // 这一轮的提问已经在开头：后面的用户提问都是复查消息。
        for (let index = 1; index < group.length; index += 1) {
            const message = group[index]!;
            if (isQuestion(message)) group[index] = cached(cache, message, "recheck", () => recheckLine(message));
        }
        const refs = info.unverifiedRefs ?? [];
        if (refs.length > 0) {
            const last = group.findLastIndex(message => message.kind === "assistant" && message.text.trim() !== "");
            if (last >= 0) {
                const reply = group[last]!;
                const key = `refs:${refs.join(",")}`;
                group[last] = cached(cache, reply, key, () => (reply.kind === "assistant" ? {...reply, annotations: [...(reply.annotations ?? []), {customType: UNVERIFIED_REFS, text: `没核实的出处：${refs.join("、")}`, details: {refs: [...refs]}}]} : reply));
            }
        }
        result.push(...group);
    });
    return result;
}
