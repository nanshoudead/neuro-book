/**
 * 秘密与知情状态：`secrets.matrix`，以及人物卡里“知道的秘密”（docs/specs/story/queries.md 输出 7、9）。
 */

import type {Awareness, StoryResult} from "../../contract/contract";
import type {Knowledge, Position, Secret} from "../dataset";
import {READER} from "../identity";
import {comparePosition} from "../position";
import type {BookView} from "../projection";
import {firstRef, type QueryContext} from "./context";

/** 一个人（几个对象）在 P 之前对一个秘密最新的知情记录：对秘密本身或它名下的说法，取最晚的一条；同一位置以对秘密的为准。 */
function latestRecord(view: BookView, who: Iterable<string>, secret: Secret): Knowledge | null {
    let best: {item: Knowledge; onSecret: boolean} | null = null;
    const targets = [secret.id, ...secret.statements];
    for (const person of who) {
        for (const target of targets) {
            for (const item of view.knowledgeOf(person, target)) {
                const onSecret = target === secret.id;
                const order = best === null ? 1 : comparePosition(item.at, best.item.at);
                if (order > 0 || (order === 0 && onSecret && !best!.onSecret)) best = {item, onSecret};
            }
        }
    }
    return best?.item ?? null;
}

/** 人物一格（输出 9）：这个人最新的知情状态与出处；没有记录时为“没有记录”。 */
export function personSecretState(view: BookView, who: Iterable<string>, secret: Secret): {state: Awareness; ref: string | null} {
    const latest = latestRecord(view, who, secret);
    return latest ? {state: latest.state, ref: firstRef(latest.evidence, latest.at)} : {state: "no-record", ref: null};
}

/**
 * 读者一格（输出 9）：名下有一条已成立的确定身份连接，或读者最新的知情为知道、读到，就是“知道”，出处取这些里最早
 * 成立的那条；否则取读者最新的知情状态。读者后来又被写成不知道、怀疑的，不再算知道。
 */
export function readerSecretState(view: BookView, secret: Secret): {state: Awareness; ref: string | null} {
    const candidates: {at: Position; ref: string}[] = [];
    for (const link of view.index.identityLinks) {
        const statement = view.statement(link.statement.id);
        if (!link.certain || !secret.statements.includes(link.statement.id) || !statement) continue;
        candidates.push({at: statement.at, ref: firstRef(statement.source.evidence, statement.at)});
    }
    const latest = latestRecord(view, [READER], secret);
    if (latest && (latest.state === "knows" || latest.state === "read")) candidates.push({at: latest.at, ref: firstRef(latest.evidence, latest.at)});
    if (candidates.length > 0) {
        candidates.sort((a, b) => comparePosition(a.at, b.at));
        return {state: "knows", ref: candidates[0]!.ref};
    }
    return latest ? {state: latest.state, ref: firstRef(latest.evidence, latest.at)} : {state: "no-record", ref: null};
}

export function secretsMatrix(ctx: QueryContext): StoryResult<"secrets.matrix"> {
    const {view, grouping} = ctx;
    const secrets = view.secrets;
    // 列：读者，加上对这些秘密至少有一条知情记录的人物，按出场次数排。
    const people = new Set<string>();
    for (const secret of secrets) {
        for (const target of [secret.id, ...secret.statements]) {
            for (const item of view.knowledge) {
                if (item.about !== target || item.who === READER) continue;
                const node = grouping.nodeOf.get(item.who);
                if (node !== undefined) people.add(node);
            }
        }
    }
    const columns = [...people].sort((a, b) => grouping.mentions.get(b)! - grouping.mentions.get(a)! || (a < b ? -1 : 1));
    return {
        columns: [{id: READER, label: "读者"}, ...columns.map(id => ({id, label: grouping.labels.get(id)!}))],
        rows: secrets.map(secret => {
            const reader = readerSecretState(view, secret);
            return {
                id: secret.id,
                title: secret.title,
                revealedAt: reader.state === "knows" ? reader.ref : null,
                cells: [
                    {column: READER, ...reader},
                    ...columns.map(column => ({column, ...personSecretState(view, grouping.members.get(column) ?? [], secret)})),
                ],
            };
        }),
    };
}
