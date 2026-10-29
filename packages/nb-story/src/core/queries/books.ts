/**
 * 书的信息与统计：`book.info`、`book.stats`（docs/specs/story/queries.md 方法清单、输出 2）。
 */

import type {StoryResult} from "../../contract/contract";
import {featuresOf} from "../dataset";
import type {QueryContext} from "./context";
import {revisionCounts} from "./revisions";

/** 说明与统计里的出场热力图画几个人物。 */
const CAST = 12;
const CAST_KINDS: ReadonlySet<string> = new Set(["person", "persona"]);

/** 图自己的部分；未抽取的尾部（`unextracted` 和 toc 里尾部各章）由 api.ts 的 `withTail` 补上。 */
export function bookInfo(ctx: QueryContext): Omit<StoryResult<"book.info">, "unextracted"> {
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
        features: featuresOf(ctx.index.dataset.book.features),
        revisions: revisionCounts(ctx.index, at),
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
        chapters: chapterCounts(ctx),
        cast: castByChapter(ctx),
        extraction: {scope: "book", written: stats.written, generated: stats.generated, chars: stats.chars},
    };
}

/** 逐章的可见记录数（输出 2）：每条记录算在它成立的那一章，只到阅读位置所在章。 */
function chapterCounts(ctx: QueryContext): StoryResult<"book.stats">["chapters"] {
    const {view} = ctx;
    const rows = Array.from({length: view.at.chapter}, (_, index) => ({chapter: index + 1, statements: 0, knowledge: 0, episodes: 0, ledger: 0, raised: 0, answered: 0}));
    const add = (chapter: number, key: Exclude<keyof (typeof rows)[number], "chapter">) => {
        const row = rows[chapter - 1];
        if (row) row[key] += 1;
    };
    for (const item of view.statements) add(item.at.chapter, "statements");
    for (const item of view.knowledge) add(item.at.chapter, "knowledge");
    for (const item of view.episodes) add(item.at.chapter, "episodes");
    for (const item of view.ledger) add(item.at.chapter, "ledger");
    for (const question of view.questions) {
        add(question.at.chapter, "raised");
        for (const update of question.updates) if (update.type === "answered") add(update.at.chapter, "answered");
    }
    return rows;
}

/** 出场最多的人物逐章被提到的次数（输出 2）：按这次的分组数，只数阅读位置之前的称呼出现。 */
function castByChapter(ctx: QueryContext): StoryResult<"book.stats">["cast"] {
    const {view, grouping} = ctx;
    const nodes = [...grouping.mentions]
        .filter(([node]) => CAST_KINDS.has(view.entity(node)?.kind ?? ""))
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, CAST)
        .map(([node]) => node);
    const counts = new Map(nodes.map(node => [node, new Array<number>(view.at.chapter).fill(0)]));
    for (const mention of view.mentions) {
        const row = counts.get(grouping.nodeOf.get(mention.entity) ?? "");
        if (row && mention.at.chapter <= row.length) row[mention.at.chapter - 1]! += 1;
    }
    return nodes.map(node => ({id: node, label: grouping.labels.get(node)!, counts: counts.get(node)!}));
}
