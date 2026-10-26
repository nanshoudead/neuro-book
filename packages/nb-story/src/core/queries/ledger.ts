/**
 * 数值、任务与道具：`ledger.tracks`、`ledger.track`（docs/specs/story/queries.md 输出 10）。
 *
 * 一项数值由（主人所在的点，名目）确定。流水按出处先后逐笔累加：原文报出的余额（`set` 的数值，或收支同时写明的
 * 数值 `value`）以原文为准，`gap` 是它与累加值的差；第一次报数之前起始金额未知，余额是相对值。数据里的
 * `running`、`check` 是抽取管线按全书算的，这里不用，按可见的流水重算。
 */

import type {NodeRef, StoryParams, StoryResult} from "../../contract/contract";
import type {LedgerEntry} from "../dataset";
import {StoryError} from "../errors";
import {firstRef, nodeRef, refs, type QueryContext} from "./context";

type TrackKind = "resource" | "task" | "item";
type Row = StoryResult<"ledger.track">["entries"][number];

interface Track {
    name: string;
    owner: NodeRef;
    entries: LedgerEntry[];
}

const ITEM_OPS = new Set(["get", "lose", "use"]);

/** 名目以“任务”开头的是任务；用得到、失去、用掉记账的是道具；其余是资源。 */
function kindOf(track: Track): TrackKind {
    if (/^任务[：:]/u.test(track.name)) return "task";
    if (track.entries.every(entry => ITEM_OPS.has(entry.op))) return "item";
    return "resource";
}

function tracksOf(ctx: QueryContext): Track[] {
    const byKey = new Map<string, Track>();
    for (const entry of ctx.view.ledger) {
        const owner = nodeRef(ctx.grouping, entry.owner);
        if (!owner) continue;
        const key = `${owner.id}\u0000${entry.track}`;
        const track = byKey.get(key);
        if (track) track.entries.push(entry);
        else byKey.set(key, {name: entry.track, owner, entries: [entry]});
    }
    return [...byKey.values()];
}

/** 逐笔对账。数量类的余额按数值算；写成文字的状态（“进行中”“六位数”）直接作为当前值。 */
function reconcile(ctx: QueryContext, track: Track): {rows: Row[]; current: number | string | null; relative: boolean} {
    let balance: number | null = null;
    let known = false;
    let current: number | string | null = null;
    const rows: Row[] = [];
    for (const entry of track.entries) {
        const amount = typeof entry.amount === "number" ? entry.amount : null;
        const change = amount === null ? null : entry.op === "spend" || entry.op === "lose" || entry.op === "use" ? -amount : amount;
        let gap: number | null = null;
        if (change !== null) {
            balance = (balance ?? 0) + change;
            current = balance;
        }
        if (typeof entry.value === "number") {
            // 原文报出余额：以原文为准。之前已知绝对余额时，差额就是原文与累加值之差。
            if (known && balance !== null) gap = entry.value - balance;
            balance = entry.value;
            known = true;
            current = balance;
        } else if (typeof entry.value === "string") {
            current = entry.value;
        }
        rows.push({
            id: entry.id,
            op: entry.op,
            change,
            value: entry.value ?? null,
            item: entry.item === undefined ? null : nodeRef(ctx.grouping, entry.item),
            balance,
            relative: balance !== null && !known,
            gap,
            reason: entry.reason,
            refs: refs(entry.evidence),
        });
    }
    return {rows, current, relative: balance !== null && !known};
}

function summary(ctx: QueryContext, track: Track): StoryResult<"ledger.tracks">["tracks"][number] {
    const {rows, current, relative} = reconcile(ctx, track);
    const last = track.entries.at(-1)!;
    return {
        name: track.name,
        owner: track.owner,
        kind: kindOf(track),
        current,
        relative,
        lastRef: firstRef(last.evidence, last.at),
        mismatches: rows.filter(row => row.gap !== null && row.gap !== 0).length,
        entries: rows.length,
    };
}

export function ledgerTracks(ctx: QueryContext): StoryResult<"ledger.tracks"> {
    const tracks = tracksOf(ctx).map(track => summary(ctx, track));
    // 最近有变动的在前；同一位置按名目。
    const lastAt = new Map(tracksOf(ctx).map(track => [`${track.owner.id}\u0000${track.name}`, track.entries.at(-1)!.at]));
    tracks.sort((a, b) => {
        const left = lastAt.get(`${a.owner.id}\u0000${a.name}`)!;
        const right = lastAt.get(`${b.owner.id}\u0000${b.name}`)!;
        return right.chapter - left.chapter || right.paragraph - left.paragraph || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return {tracks};
}

export function ledgerTrack(ctx: QueryContext, params: StoryParams<"ledger.track">): StoryResult<"ledger.track"> {
    const owner = params.owner === undefined ? undefined : ctx.resolveEntity(params.owner);
    const matching = tracksOf(ctx).filter(track => track.name === params.track && (owner === undefined || track.owner.id === owner));
    if (matching.length === 0) throw new StoryError("entity_not_found", `这个阅读位置没有“${params.track}”这项数值`);
    if (matching.length > 1) {
        const candidates = matching.map(track => ({id: track.owner.id, label: track.owner.label, note: `${track.owner.label}的${track.name}`}));
        throw new StoryError("entity_ambiguous", `“${params.track}”有 ${matching.length} 个主人，请用 owner 指定：${candidates.map(item => item.label).join("、")}`, {candidates});
    }
    const track = matching[0]!;
    return {track: summary(ctx, track), entries: reconcile(ctx, track).rows};
}
