/**
 * 挑选相关说法（docs/specs/story/ingest.md 输出 4）：从规则缩小的候选（context.ts 的 `recallCandidates`）里挑出写这一章
 * 可能要用到的说法，放进这一章的已有记录。默认关，开关与模型在配置的 `ingest.recall`。
 *
 * 挑选的方式可以替换：输入是候选与本章原文，输出是选中的编号。现在只有 LLM 一种，一次请求看全部候选；以后接
 * decision 模型时输入输出相同、执行过程不同（例如逐条判断）。请求的发送、重发与失败由调用方（chapter.ts）给的
 * `ask` 负责，与抽取的其他步骤相同。
 */

import {renderChapter} from "./prompts";

export interface RecallCandidate {
    id: string;
    text: string;
}

export interface RecallInput {
    chapter: number;
    paragraphs: string[];
    /** 按原文先后。 */
    candidates: RecallCandidate[];
    limit: number;
}

export interface Recaller {
    /** 选中的编号：都在候选里、不重复，按候选的先后。 */
    select(input: RecallInput): Promise<string[]>;
}

/** 一章至多挑这么多条。 */
export const RECALL_LIMIT = 40;

/** 发一次请求、拿回成形的 JSON；回复不成形时重发一次，仍不成形抛 `IngestBadReply`（见 chapter.ts）。 */
export type RecallAsk = (system: string, user: string, valid: (json: unknown) => boolean) => Promise<unknown>;

const SYSTEM = "你帮小说记忆图的抽取程序挑选前文已有的说法。只输出一个 JSON 对象。";

export function recallPrompt(input: RecallInput): string {
    return `【任务】下面是小说第 ${input.chapter} 章的原文，和前文已经记下的一批说法。挑出写这一章的记录时可能用到的说法：这一章会印证、反驳或修正的，可以作为推断依据的，和这一章的人物处境、情节直接相关的。至多 ${input.limit} 条，按相关程度从高到低排。只输出：{"ids":["s3-1", …]}；都不相关就输出 {"ids":[]}。

【第 ${input.chapter} 章原文】
${renderChapter(input.chapter, input.paragraphs)}

【前文的说法】
${input.candidates.map(item => `${item.id}　${item.text}`).join("\n")}`;
}

/**
 * 回复里的编号。`ids` 不是字符串数组时为 null（回复不成形，要重发）。不在候选里的丢掉、重复的去掉；超过 `limit`
 * 时按回复的先后（模型按相关程度排）留前面的；最后按候选的先后排，让同样的选择渲染出同样的已有记录。
 */
export function parseRecall(json: unknown, input: RecallInput): string[] | null {
    const ids = typeof json === "object" && json !== null ? (json as {ids?: unknown}).ids : undefined;
    if (!Array.isArray(ids) || !ids.every(id => typeof id === "string")) return null;
    const order = new Map(input.candidates.map((item, index) => [item.id, index]));
    const kept = [...new Set(ids as string[])].filter(id => order.has(id)).slice(0, input.limit);
    return kept.sort((a, b) => order.get(a)! - order.get(b)!);
}

/** 用一个 LLM 挑：一次请求看全部候选。 */
export function llmRecaller(ask: RecallAsk): Recaller {
    return {
        async select(input) {
            const reply = await ask(SYSTEM, recallPrompt(input), json => parseRecall(json, input) !== null);
            return parseRecall(reply, input)!;
        },
    };
}
