/**
 * 原文：`source.read`、`source.records`（docs/specs/story/queries.md 输出 14）。
 *
 * 这里是不剧透的唯一例外：P 所在章里 P 之后的段落照常给原文，但不给任何记录（`recordCount` 为 0、
 * `source.records` 为空），称呼只标 P 时已可见的写法。P 所在章之后的章报 `beyond_position`。
 */

import {isGenericName} from "../generic-names";
import type {PositionInput, StoryParams, StoryResult, Tags} from "../../contract/contract";
import type {Citation} from "../book-index";
import {StoryError} from "../errors";
import {visibleAt} from "../position";
import type {BookView} from "../projection";
import {refs, tags, type QueryContext} from "./context";

type Paragraph = StoryResult<"source.read">["paragraphs"][number];

function checkChapter(ctx: QueryContext, chapter: number): number {
    const source = ctx.index.chapters.get(chapter);
    if (!source) throw new StoryError("position_out_of_range", `没有第 ${chapter} 章`);
    if (chapter > ctx.view.at.chapter) throw new StoryError("beyond_position", `第 ${chapter} 章在阅读位置之后`);
    return source.paragraphs.length;
}

/** 一次引用在 P 时是否可见：引用自己的位置可见，且所引的记录在视图里。 */
function citationVisible(view: BookView, citation: Citation): boolean {
    if (!visibleAt(citation.at, view.at)) return false;
    switch (citation.type) {
        case "statement":
            return view.statement(citation.id) !== undefined;
        case "knowledge":
            return view.knowledgeItem(citation.id) !== undefined;
        case "episode":
            return view.episode(citation.id) !== undefined;
        case "ledger":
            return view.ledgerEntry(citation.id) !== undefined;
        case "question":
            return view.question(citation.id) !== undefined;
        case "time":
            return view.time(citation.id) !== undefined;
    }
}

function visibleCitations(ctx: QueryContext, chapter: number, paragraph: number): Citation[] {
    const {view} = ctx;
    if (!visibleAt({chapter, paragraph}, view.at)) return [];
    return (ctx.index.citations.get(`${chapter}.${paragraph}`) ?? []).filter(citation => citationVisible(view, citation));
}

export function sourceRead(ctx: QueryContext, params: StoryParams<"source.read">): StoryResult<"source.read"> {
    const {view, grouping, index} = ctx;
    const from = params.from;
    const to: PositionInput = params.to ?? (from.paragraph === undefined ? {chapter: from.chapter} : from);
    if (to.chapter < from.chapter || (to.chapter === from.chapter && from.paragraph !== undefined && to.paragraph !== undefined && to.paragraph < from.paragraph)) {
        throw new StoryError("invalid_params", "原文范围的终点在起点之前");
    }
    const lengths = new Map<number, number>();
    for (let chapter = from.chapter; chapter <= to.chapter; chapter += 1) lengths.set(chapter, checkChapter(ctx, chapter));
    const firstParagraph = from.paragraph ?? 1;
    const lastParagraph = to.paragraph ?? lengths.get(to.chapter)!;
    if (firstParagraph < 1 || firstParagraph > lengths.get(from.chapter)! || lastParagraph < 1 || lastParagraph > lengths.get(to.chapter)!) {
        throw new StoryError("position_out_of_range", "原文范围超出这一章的段数");
    }
    const visibleBeats = new Map(view.beats.map(beat => [`${beat.chapter}.${beat.from}`, beat]));
    const paragraphs: Paragraph[] = [];
    for (let chapter = from.chapter; chapter <= to.chapter; chapter += 1) {
        const text = index.chapters.get(chapter)!.paragraphs;
        const start = chapter === from.chapter ? firstParagraph : 1;
        const end = chapter === to.chapter ? lastParagraph : text.length;
        for (let paragraph = start; paragraph <= end; paragraph += 1) {
            const key = `${chapter}.${paragraph}`;
            const visible = visibleAt({chapter, paragraph}, view.at);
            const names = (index.mentionsByParagraph.get(key) ?? [])
                .filter(mention => {
                    const entity = view.entity(mention.entity);
                    // 泛称不链到对象：每一处“学姐”都链到同一个人是错的。
                    if (!entity || isGenericName(mention.text)) return false;
                    // 本章 P 之后的段落：只标 P 时已经可见的写法。
                    return visible || entity.names.some(name => name.text === mention.text);
                })
                .map(mention => ({entity: grouping.nodeOf.get(mention.entity)!, text: mention.text, start: mention.start, end: mention.end}));
            const beat = visibleBeats.get(key);
            paragraphs.push({
                chapter,
                paragraph,
                text: text[paragraph - 1]!,
                names,
                beat: beat ? {id: beat.id, gist: beat.gist, from: beat.from, to: beat.to} : null,
                recordCount: visible ? visibleCitations(ctx, chapter, paragraph).length : 0,
            });
        }
    }
    return {paragraphs};
}

export function sourceRecords(ctx: QueryContext, params: StoryParams<"source.records">): StoryResult<"source.records"> {
    const {view} = ctx;
    const length = checkChapter(ctx, params.chapter);
    if (params.paragraph < 1 || params.paragraph > length) throw new StoryError("position_out_of_range", `第 ${params.chapter} 章没有第 ${params.paragraph} 段`);
    const records = visibleCitations(ctx, params.chapter, params.paragraph).map(citation => {
        let text = citation.id;
        let recordTags: Tags | null = null;
        let spans: Parameters<typeof refs>[0] = [];
        switch (citation.type) {
            case "statement": {
                const statement = view.statement(citation.id)!;
                text = statement.text;
                recordTags = tags(statement.kind, statement.basis);
                spans = statement.source.evidence;
                break;
            }
            case "knowledge": {
                const item = view.knowledgeItem(citation.id)!;
                const about = view.statement(item.about);
                const who = ctx.grouping.labels.get(ctx.grouping.nodeOf.get(item.who) ?? "") ?? (item.who === "reader" ? "读者" : item.who);
                text = `${who}${STATE_WORDS[item.state]}：${about?.text ?? view.secret(item.about)?.title ?? item.about}`;
                recordTags = tags(about?.kind ?? null, item.basis);
                spans = item.evidence;
                break;
            }
            case "episode": {
                const episode = view.episode(citation.id)!;
                text = `${episode.title}：${episode.summary}`;
                spans = episode.evidence;
                break;
            }
            case "ledger": {
                const entry = view.ledgerEntry(citation.id)!;
                text = `${entry.track}：${entry.reason}`;
                spans = entry.evidence;
                break;
            }
            case "question": {
                const question = view.question(citation.id)!;
                text = question.text;
                spans = question.evidence;
                break;
            }
            case "time": {
                const time = view.time(citation.id)!;
                text = time.label;
                spans = time.evidence;
                break;
            }
        }
        return {type: citation.type, id: citation.id, text, tags: recordTags, refs: refs(spans)};
    });
    return {records};
}

const STATE_WORDS = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道"} as const;
