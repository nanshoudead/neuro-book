/**
 * 悬念：`questions.list`（docs/specs/story/queries.md 输出 11）。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import type {Episode, Question, Span} from "../dataset";
import {comparePosition} from "../position";
import {matches, nodeRefs, refs, type QueryContext} from "./context";

/** 展开一条悬念时列出的相关情节至多几段。 */
const RELATED_EPISODES = 6;

type State = "open" | "partial" | "answered";

/** P 之前的最新进展决定状态；只有“提出”或没有进展时是未解。 */
function stateOf(question: Question): State {
    const last = question.updates.filter(update => update.type !== "raised").at(-1);
    return last === undefined ? "open" : last.type === "answered" ? "answered" : "partial";
}

/** 到 P 为止没有任何进展、且只在提出它的那一章被提到。 */
function trivialOf(question: Question): boolean {
    if (question.updates.some(update => update.type !== "raised")) return false;
    const chapter = question.at.chapter;
    return question.evidence.every(span => span.chapter === chapter) && question.updates.every(update => update.evidence.every(span => span.chapter === chapter));
}

/** 最近一次被提到（提出或进展）的位置，用于“最近有进展的在前”。 */
function lastTouched(question: Question) {
    return question.updates.reduce((latest, update) => (comparePosition(update.at, latest) > 0 ? update.at : latest), question.at);
}

function overlaps(a: Span, b: Span): boolean {
    return a.chapter === b.chapter && a.from <= b.to && b.from <= a.to;
}

/** 相关情节（输出 11）：出处与悬念的提出或可见进展的出处有重叠的可见情节，按章排序，至多 RELATED_EPISODES 段。 */
function relatedEpisodes(episodes: readonly Episode[], question: Question) {
    const spans = [...question.evidence, ...question.updates.flatMap(update => update.evidence)];
    return episodes
        .filter(episode => episode.evidence.some(span => spans.some(other => overlaps(span, other))))
        .slice(0, RELATED_EPISODES)
        .map(episode => ({id: episode.id, title: episode.title, chapter: episode.at.chapter, refs: refs(episode.evidence)}));
}

export function questionsList(ctx: QueryContext, params: StoryParams<"questions.list">): StoryResult<"questions.list"> {
    const {view, grouping} = ctx;
    const rows = view.questions
        .map(question => {
            const about = nodeRefs(grouping, question.about);
            return {question, state: stateOf(question), about};
        })
        .filter(row => params.state === undefined || row.state === params.state)
        .filter(row => matches(row.question.text, params.query) || row.about.some(item => matches(item.label, params.query)));
    if ((params.sort ?? "recent") === "recent") {
        rows.sort((a, b) => comparePosition(lastTouched(b.question), lastTouched(a.question)) || (a.question.id < b.question.id ? -1 : 1));
    }
    return ctx.page(
        rows.map(({question, state, about}) => ({
            id: question.id,
            text: question.text,
            state,
            trivial: trivialOf(question),
            about,
            raised: {refs: refs(question.evidence), chapter: question.at.chapter},
            updates: question.updates.map(update => ({
                type: update.type,
                answer: update.answer === undefined ? null : (view.statement(update.answer)?.text ?? null),
                note: update.note ?? null,
                refs: refs(update.evidence),
                chapter: update.at.chapter,
            })),
            episodes: relatedEpisodes(view.episodes, question),
        })),
    );
}
