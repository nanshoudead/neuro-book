/**
 * 阅读位置与出处的解析、比较和书写。阅读位置的规则见 docs/specs/story/queries.md 的“阅读位置的规则”。
 */

import type {Position, SourceChapter, Span} from "./dataset";
import {StoryError} from "./errors";

/** 调用方给的阅读位置：只给章表示读完这一章。 */
export interface PositionInput {
    chapter: number;
    paragraph?: number;
}

export const comparePosition = (a: Position, b: Position): number => a.chapter - b.chapter || a.paragraph - b.paragraph;

/** 记录在阅读位置 `readAt` 是否可见：成立位置不晚于阅读位置。 */
export const visibleAt = (at: Position, readAt: Position): boolean => comparePosition(at, readAt) <= 0;

export const formatPosition = (at: Position): string => `${at.chapter}.${at.paragraph}`;

/** 出处的书写：单段 `38.57`，范围 `38.50—38.81`。 */
export function formatSpan(span: Span): string {
    return span.from === span.to ? `${span.chapter}.${span.from}` : `${span.chapter}.${span.from}—${span.chapter}.${span.to}`;
}

/** 解析命令行与地址里的 `章` 或 `章.段`；写法不对时为 null（由调用方报参数错误）。 */
export function parsePositionText(text: string): PositionInput | null {
    const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/u.exec(text.trim());
    if (!match) return null;
    const chapter = Number(match[1]);
    return match[2] === undefined ? {chapter} : {chapter, paragraph: Number(match[2])};
}

/**
 * 把调用方的阅读位置落到一个具体的段上。不给时取全书已抽取到的位置 `through`；只给章时取这一章的最后一段。
 * 章不在原文里、段超出这一章、或为 0 与负数时报 `position_out_of_range`。
 */
export function resolvePosition(input: PositionInput | undefined, sources: ReadonlyMap<number, SourceChapter>, through: Position): Position {
    if (input === undefined) return through;
    const chapter = sources.get(input.chapter);
    if (!chapter || !Number.isInteger(input.chapter) || input.chapter <= 0) {
        throw new StoryError("position_out_of_range", `没有第 ${input.chapter} 章`);
    }
    const last = chapter.paragraphs.length;
    if (input.paragraph === undefined) return {chapter: input.chapter, paragraph: last};
    if (!Number.isInteger(input.paragraph) || input.paragraph <= 0 || input.paragraph > last) {
        throw new StoryError("position_out_of_range", `第 ${input.chapter} 章没有第 ${input.paragraph} 段（共 ${last} 段）`);
    }
    return {chapter: input.chapter, paragraph: input.paragraph};
}
