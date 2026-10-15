/**
 * 书的信息与统计：`book.info`、`book.stats`（docs/specs/story/queries.md 方法清单、输出 2）。
 */

import type {StoryResult} from "../../contract/contract";
import type {QueryContext} from "./context";

export function bookInfo(ctx: QueryContext): StoryResult<"book.info"> {
    const {meta} = ctx.index;
    const at = ctx.view.at;
    const toc = [...ctx.index.chapters.values()]
        .sort((a, b) => a.chapter - b.chapter)
        .map(chapter => ({chapter: chapter.chapter, title: chapter.chapter <= at.chapter ? chapter.title : null}));
    return {
        id: meta.id,
        title: meta.title,
        generation: meta.generation,
        source: meta.source,
        chapters: meta.chapters,
        paragraphs: meta.paragraphs,
        toc,
        extractedThrough: meta.extractedThrough,
        at,
    };
}

export function bookStats(ctx: QueryContext): StoryResult<"book.stats"> {
    const {view} = ctx;
    const {stats} = ctx.index.dataset;
    return {
        at: view.at,
        visible: {
            entities: view.entities.length,
            names: view.entities.reduce((sum, entity) => sum + entity.names.length, 0),
            mentions: view.mentions.length,
            statements: view.statements.length,
            secrets: view.secrets.length,
            knowledge: view.knowledge.length,
            episodes: view.episodes.length,
            ledger: view.ledger.length,
            questions: view.questions.length,
            questionUpdates: view.questions.reduce((sum, question) => sum + question.updates.length, 0),
            times: view.times.length,
            beats: view.beats.length,
            summaries: view.summaries.length,
            arcs: view.arcs.arcs.length,
        },
        extraction: {scope: "book", written: stats.written, generated: stats.generated, chars: stats.chars},
    };
}
