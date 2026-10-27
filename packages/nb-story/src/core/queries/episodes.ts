/**
 * 情节、主线与本章变化：`episodes.list`、`arcs.list`、`chapter.digest`（docs/specs/story/queries.md 输出 13）。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import {StoryError} from "../errors";
import {firstRef, matches, nodeRef, participants, refs, type QueryContext} from "./context";
import {readerSecretState} from "./secrets";
import {episodeTier} from "../tiers";

/** 情节 → 它在当前这一批里所属的主线。 */
function arcsByEpisode(ctx: QueryContext): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const arc of ctx.view.arcs.arcs) {
        for (const id of arc.episodes) {
            const list = map.get(id);
            if (list) list.push(arc.id);
            else map.set(id, [arc.id]);
        }
    }
    return map;
}

/** 情节所挂的时间点；不可见时为 null（输出 1 的“引用省略”）。 */
function timeRef(ctx: QueryContext, id: string): {id: string; label: string} | null {
    const time = ctx.view.time(id);
    return time ? {id: time.id, label: time.label} : null;
}

export function episodesList(ctx: QueryContext, params: StoryParams<"episodes.list">): StoryResult<"episodes.list"> {
    const {view, grouping} = ctx;
    const byEpisode = arcsByEpisode(ctx);
    const items = view.episodes
        .filter(episode => params.arc === undefined || (byEpisode.get(episode.id) ?? []).includes(params.arc))
        .filter(episode => matches(episode.title, params.query) || matches(episode.summary, params.query))
        .map(episode => ({
            id: episode.id,
            title: episode.title,
            chapter: episode.at.chapter,
            who: participants(ctx, episode),
            place: episode.place === undefined ? null : nodeRef(grouping, episode.place),
            time: timeRef(ctx, episode.time),
            summary: episode.summary,
            steps: episode.steps.map(step => ({text: step.text, ref: refs([step.evidence])[0]!})),
            outcome: episode.outcome ?? null,
            links: episode.links.map(link => ({type: link.type, to: {id: link.to, title: view.episode(link.to)!.title}, note: link.note ?? null})),
            arcs: byEpisode.get(episode.id) ?? [],
            refs: refs(episode.evidence),
            tier: episodeTier(episode),
        }));
    return ctx.page(items);
}

export function arcsList(ctx: QueryContext): StoryResult<"arcs.list"> {
    const {through, arcs} = ctx.view.arcs;
    return {through, arcs: arcs.map(arc => ({id: arc.id, title: arc.title, summary: arc.summary, status: arc.status, episodes: arc.episodes}))};
}

export function chapterDigest(ctx: QueryContext, params: StoryParams<"chapter.digest">): StoryResult<"chapter.digest"> {
    const {view, grouping, index} = ctx;
    const source = index.chapters.get(params.chapter);
    if (!source) throw new StoryError("position_out_of_range", `没有第 ${params.chapter} 章`);
    if (params.chapter > view.at.chapter) throw new StoryError("beyond_position", `第 ${params.chapter} 章在阅读位置之后`);
    const inChapter = (at: {chapter: number}) => at.chapter === params.chapter;
    const progressed: StoryResult<"chapter.digest">["questions"]["progressed"] = [];
    for (const question of view.questions) {
        for (const update of question.updates) {
            if (update.type !== "raised" && inChapter(update.at)) progressed.push({id: question.id, text: question.text, type: update.type, ref: firstRef(update.evidence, update.at)});
        }
    }
    return {
        chapter: params.chapter,
        title: source.title,
        episodes: view.episodes.filter(episode => inChapter(episode.at)).map(episode => ({id: episode.id, title: episode.title, summary: episode.summary, refs: refs(episode.evidence)})),
        newEntities: view.entities
            .filter(entity => inChapter(entity.at))
            .map(entity => ({id: entity.id, label: entity.names[0]?.text ?? grouping.labels.get(grouping.nodeOf.get(entity.id)!)!, kind: entity.kind, ref: `${entity.at.chapter}.${entity.at.paragraph}`})),
        revealedSecrets: view.secrets.flatMap(secret => {
            const reader = readerSecretState(view, secret);
            return reader.state === "knows" && reader.ref !== null && Number(reader.ref.split(".")[0]) === params.chapter ? [{id: secret.id, title: secret.title, ref: reader.ref}] : [];
        }),
        ledger: view.ledger
            .filter(entry => inChapter(entry.at))
            .flatMap(entry => {
                const owner = nodeRef(grouping, entry.owner);
                if (!owner) return [];
                const amount = typeof entry.amount === "number" ? entry.amount : null;
                const change = amount === null ? null : entry.op === "spend" || entry.op === "lose" || entry.op === "use" ? -amount : amount;
                return [{track: entry.track, owner, op: entry.op, change, value: entry.value ?? null, ref: firstRef(entry.evidence, entry.at)}];
            }),
        questions: {
            raised: view.questions.filter(question => inChapter(question.at)).map(question => ({id: question.id, text: question.text, ref: firstRef(question.evidence, question.at)})),
            progressed,
        },
    };
}
