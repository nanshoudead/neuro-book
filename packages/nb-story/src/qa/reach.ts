/**
 * 问答能到达的范围（w00024 t30）：已提交的章加上还没抽取的尾部（core/unextracted.ts）。
 *
 * 阅读位置 P 可以落在尾部章里；那时图只回答到抽取进度（图位置 `graphAt`），尾部章的原文只能用 `read` 读。
 * 位置的段数表（章末判定、账本）一律用这里的 `paragraphs`，不直接用 `book.meta.paragraphs`：后者只有已提交的章。
 */

import type {StoryResult} from "../contract/contract";
import type {BookSession} from "../core/api";
import type {BookFeatures, Position, SourceChapter} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";

type Paragraph = StoryResult<"source.read">["paragraphs"][number];

export interface Reach {
    /** 对话的阅读位置，已落到具体的段。 */
    readonly at: Position;
    /** 图工具用的位置：P 在已提交的章里就是 P，否则是抽取进度。 */
    readonly graphAt: Position;
    /** 已提交加尾部各章的段数。 */
    readonly paragraphs: readonly number[];
    readonly tail: readonly SourceChapter[];
    readonly features: BookFeatures;
    /** 已提交的章数（尾部章号都比它大）。 */
    readonly committed: number;
}

/** 把调用方给的位置落到这本书能到达的范围里；不给取抽取进度。位置不在范围内报 `position_out_of_range`。 */
export async function resolveReach(book: BookSession, input?: PositionInput): Promise<Reach> {
    const tail = await book.unextracted();
    const committed = book.meta.paragraphs.length;
    const paragraphs = [...book.meta.paragraphs, ...tail.map(chapter => chapter.paragraphs.length)];
    const inTail = input !== undefined && input.chapter > committed && tail.some(chapter => chapter.chapter === input.chapter);
    // 已提交范围内（以及不在范围里的错误）照旧由 book.info 落位与报错。
    const graphInput = inTail ? undefined : input;
    const info = await book.call("book.info", graphInput === undefined ? {} : {at: graphInput});
    if (!info.ok) throw new StoryError(info.error.code, info.error.message);
    if (!inTail) return {at: info.value.at, graphAt: info.value.at, paragraphs, tail, features: info.value.features, committed};
    const last = paragraphs[input.chapter - 1]!;
    if (input.paragraph !== undefined && (!Number.isInteger(input.paragraph) || input.paragraph < 1 || input.paragraph > last)) {
        throw new StoryError("position_out_of_range", `第 ${input.chapter} 章没有第 ${input.paragraph} 段（共 ${last} 段）`);
    }
    return {at: {chapter: input.chapter, paragraph: input.paragraph ?? last}, graphAt: info.value.at, paragraphs, tail, features: info.value.features, committed};
}

/**
 * 读 `from` 到 `to`（已经按账本裁到阅读位置以内）：已提交的部分用 `source.read`，尾部的段直接取，拼成 `source.read` 的结果形状
 * （尾部段没有称呼标记、概要与记录）。
 */
export async function readRange(book: BookSession, reach: Reach, from: Position, to: Position): Promise<StoryResult<"source.read"> | {error: StoryError}> {
    const paragraphs: Paragraph[] = [];
    if (from.chapter <= reach.committed) {
        const last = Math.min(to.chapter, reach.committed);
        const end: Position = to.chapter <= reach.committed ? to : {chapter: last, paragraph: reach.paragraphs[last - 1]!};
        const outcome = await book.call("source.read", {at: reach.graphAt, from, to: end});
        if (!outcome.ok) return {error: new StoryError(outcome.error.code, outcome.error.message)};
        paragraphs.push(...outcome.value.paragraphs);
    }
    if (to.chapter > reach.committed) {
        for (const chapter of reach.tail) {
            if (chapter.chapter < from.chapter || chapter.chapter > to.chapter) continue;
            const first = chapter.chapter === from.chapter ? from.paragraph : 1;
            const finish = chapter.chapter === to.chapter ? to.paragraph : chapter.paragraphs.length;
            for (let paragraph = first; paragraph <= finish; paragraph += 1) {
                paragraphs.push({chapter: chapter.chapter, paragraph, text: chapter.paragraphs[paragraph - 1]!, names: [], beat: null, recordCount: 0});
            }
        }
    }
    return {paragraphs};
}
