/**
 * 秘密与知情状态：`secrets.matrix`，以及人物卡里“知道的秘密”（docs/specs/story/queries.md 输出 7、9）。
 */

import type {Awareness, StoryResult} from "../../contract/contract";
import type {Knowledge, Secret} from "../dataset";
import {READER} from "../identity";
import {comparePosition, formatSpan} from "../position";
import type {BookView} from "../projection";
import {firstRef, type QueryContext} from "./context";

/** 一个人在 P 时对一个秘密的状态：对秘密本身或它名下说法的知情记录里最晚的一条；同一位置以对秘密的为准。 */
export function personSecretState(view: BookView, who: Iterable<string>, secret: Secret): {state: Awareness; ref: string | null} {
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
    return best ? {state: best.item.state, ref: firstRef(best.item.evidence, best.item.at)} : {state: "no-record", ref: null};
}

/**
 * 读者对一个秘密的状态：名下有一条已成立的确定身份连接，或读者最新的知情为知道、读到，就是“知道”，出处取最早
 * 成立的那条；否则取读者最新的知情状态。
 */
export function readerSecretState(view: BookView, secret: Secret): {state: Awareness; ref: string | null} {
    const candidates: {at: {chapter: number; paragraph: number}; ref: string}[] = [];
    for (const link of view.index.identityLinks) {
        if (!link.certain || !secret.statements.includes(link.statement.id) || view.statement(link.statement.id) === undefined) continue;
        candidates.push({at: link.statement.at, ref: link.statement.source.evidence[0] ? formatSpan(link.statement.source.evidence[0]) : `${link.statement.at.chapter}.${link.statement.at.paragraph}`});
    }
    const own = personSecretState(view, [READER], secret);
    const ownKnowledge = [secret.id, ...secret.statements].flatMap(target => view.knowledgeOf(READER, target)).filter(item => item.state === "knows" || item.state === "read");
    for (const item of ownKnowledge) candidates.push({at: item.at, ref: firstRef(item.evidence, item.at)});
    if (candidates.length > 0) {
        candidates.sort((a, b) => comparePosition(a.at, b.at));
        return {state: "knows", ref: candidates[0]!.ref};
    }
    return own;
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
