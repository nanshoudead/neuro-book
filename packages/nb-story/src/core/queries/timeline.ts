/**
 * 时间线：`timeline`（docs/specs/story/queries.md 输出 12）。
 *
 * 故事先后：日子已知的点先按第几天、再按时段排，同一天同一时段里再用数据里程序排好的 `order` 区分；日子未知的点
 * 排在最后、单独成组。补叙用同一套先后：日子已知的点，故事时间早于某个更早章节里写到的点，就是后来补叙的，标出
 * 写到它的那一章；日子未知的点不参与判断。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import {DAY_PARTS, type TimeAnchor} from "../dataset";
import {comparePosition} from "../position";
import {nodeRef, participants, refs, type QueryContext} from "./context";

const REL_WORDS = {after: "之后", before: "之前", same: "同时"} as const;

/** 故事先后的比较：第几天 → 时段（没写时段的排在这一天的最前）→ order。只用于日子已知的点。 */
function compareStory(a: TimeAnchor, b: TimeAnchor): number {
    const part = (time: TimeAnchor) => (time.part === undefined ? -1 : DAY_PARTS.indexOf(time.part));
    return a.day! - b.day! || part(a) - part(b) || a.order - b.order;
}

function relativeText(ctx: QueryContext, time: TimeAnchor): string | null {
    const rel = time.rel[0];
    if (!rel) return null;
    const target = ctx.view.time(rel.to);
    if (!target) return null;
    const amount = rel.gap ?? (rel.days !== undefined && rel.days > 0 ? `${rel.days} 天` : "");
    return rel.type === "same" ? `与“${target.label}”同时` : `“${target.label}”${REL_WORDS[rel.type]}${amount ? ` ${amount}` : ""}`;
}

export function timeline(ctx: QueryContext, params: StoryParams<"timeline">): StoryResult<"timeline"> {
    const times = ctx.view.times;
    const known = times.filter(time => time.day !== undefined);
    // 每个点之前各章里写到的点中，故事先后最晚的那个；比它早的就是补叙。
    const byChapter = [...known].sort((a, b) => comparePosition(a.at, b.at));
    const flashback = new Map<string, number>();
    let latestBefore: TimeAnchor | null = null;
    let latestInChapter: TimeAnchor | null = null;
    let chapter = -1;
    for (const time of byChapter) {
        if (time.at.chapter !== chapter) {
            if (latestInChapter && (!latestBefore || compareStory(latestInChapter, latestBefore) > 0)) latestBefore = latestInChapter;
            latestInChapter = null;
            chapter = time.at.chapter;
        }
        if (latestBefore && compareStory(time, latestBefore) < 0) flashback.set(time.id, time.at.chapter);
        if (!latestInChapter || compareStory(time, latestInChapter) > 0) latestInChapter = time;
    }
    // 每个时间点上发生的情节：情节的 time 指向这个点。
    const episodesAt = new Map<string, StoryResult<"timeline">["points"][number]["episodes"]>();
    for (const episode of ctx.view.episodes) {
        const list = episodesAt.get(episode.time) ?? [];
        list.push({
            id: episode.id,
            title: episode.title,
            who: participants(ctx, episode).map(({id, label}) => ({id, label})),
            place: episode.place === undefined ? null : nodeRef(ctx.grouping, episode.place),
        });
        episodesAt.set(episode.time, list);
    }
    const ordered = (params.order ?? "story") === "story"
        ? [...known.sort(compareStory), ...times.filter(time => time.day === undefined).sort((a, b) => a.order - b.order || comparePosition(a.at, b.at))]
        : [...times].sort((a, b) => comparePosition(a.at, b.at));
    return {
        points: ordered.map(time => ({
            id: time.id,
            label: time.label,
            day: time.day ?? null,
            part: time.part ?? null,
            clock: time.clock ?? null,
            date: time.date ?? null,
            relative: relativeText(ctx, time),
            flashback: flashback.get(time.id) ?? null,
            refs: refs(time.evidence),
            chapter: time.at.chapter,
            episodes: episodesAt.get(time.id) ?? [],
        })),
    };
}
