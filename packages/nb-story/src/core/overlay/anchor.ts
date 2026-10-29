/**
 * 修订所指目标的锚（docs/specs/story/revisions.md 输出 11）：记下目标当时的 id、位置与文字，之后在数据里认出它。
 *
 * 抽取的整理会把建重的对象并成一个：被并入的编号记在留下的对象的 `mergedFrom` 里，所以对象 id 已不在时先按它跟过去；
 * 再不行按位置与最早的称呼唯一对上；对不上就是 stale，修订不套用。
 */

import type {Dataset, Entity, Position, Statement} from "../dataset";
import {comparePosition} from "../position";
import type {Anchor} from "./schema";

const same = (a: Position, b: Position): boolean => a.chapter === b.chapter && a.paragraph === b.paragraph;

/** 对象最早的称呼（按成立位置，同位置按记录顺序）；没有称呼为 null。 */
export function firstNameOf(entity: Entity): string | null {
    let best: Entity["names"][number] | undefined;
    for (const name of entity.names) if (best === undefined || comparePosition(name.at, best.at) < 0) best = name;
    return best?.text ?? null;
}

export function entityAnchor(entity: Entity): Anchor {
    return {type: "entity", id: entity.id, at: entity.at, firstName: firstNameOf(entity)};
}

export function statementAnchor(statement: Statement): Anchor {
    return {type: "statement", id: statement.id, at: statement.at, text: statement.text};
}

/** 在数据里认出锚指的对象；认不出为 null。 */
export function resolveEntityAnchor(dataset: Dataset, anchor: Anchor): Entity | null {
    if (anchor.type !== "entity") return null;
    const direct = dataset.entities.find(entity => entity.id === anchor.id);
    if (direct && same(direct.at, anchor.at) && firstNameOf(direct) === anchor.firstName) return direct;
    const merged = dataset.entities.find(entity => entity.mergedFrom.includes(anchor.id));
    if (merged) return merged;
    const matches = dataset.entities.filter(entity => same(entity.at, anchor.at) && firstNameOf(entity) === anchor.firstName);
    return matches.length === 1 ? matches[0]! : null;
}

/** 在数据里认出锚指的说法；认不出为 null。 */
export function resolveStatementAnchor(dataset: Dataset, anchor: Anchor): Statement | null {
    if (anchor.type !== "statement") return null;
    const direct = dataset.statements.find(statement => statement.id === anchor.id);
    if (direct && same(direct.at, anchor.at) && direct.text === anchor.text) return direct;
    const matches = dataset.statements.filter(statement => same(statement.at, anchor.at) && statement.text === anchor.text);
    return matches.length === 1 ? matches[0]! : null;
}
