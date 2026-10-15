/**
 * 时间线：`timeline`（docs/specs/story/queries.md 输出 12）。
 *
 * 故事先后用数据里程序排好的 `order`。补叙：日子已知的点，故事时间早于某个更早章节里写到的点，就算后来补叙的，
 * 标出写到它的那一章；日子未知的点不参与判断。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import type {TimeAnchor} from "../dataset";
import {comparePosition} from "../position";
import {refs, type QueryContext} from "./context";

const REL_WORDS = {after: "之后", before: "之前", same: "同时"} as const;

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
    // 每个点之前各章里写到的点中，故事次序最晚的那个；比它早的就是补叙。
    const known = times.filter(time => time.day !== undefined).sort((a, b) => comparePosition(a.at, b.at));
    const flashback = new Map<string, number>();
    let latestOrderBefore = -Infinity;
    let chapter = -1;
    let latestInChapter = -Infinity;
    for (const time of known) {
        if (time.at.chapter !== chapter) {
            latestOrderBefore = Math.max(latestOrderBefore, latestInChapter);
            latestInChapter = -Infinity;
            chapter = time.at.chapter;
        }
        if (time.order < latestOrderBefore) flashback.set(time.id, time.at.chapter);
        latestInChapter = Math.max(latestInChapter, time.order);
    }
    const ordered = [...times].sort((params.order ?? "story") === "story" ? (a, b) => a.order - b.order || comparePosition(a.at, b.at) : (a, b) => comparePosition(a.at, b.at));
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
        })),
    };
}
