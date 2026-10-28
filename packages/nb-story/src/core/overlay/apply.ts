/**
 * 把修订套到数据集上（docs/specs/story/revisions.md 输出 1 到 6）。纯函数：不改入参，没有生效的修订时原样返回
 * 同一个数据集对象，所以没有修订的书所有查询的结果与以前逐字相同。
 *
 * 套用发生在 `book-index.ts` 的 `settle` 之前：新增与改写的记录和抽取来的记录一起落定、排序。每条修订自带依据位置，
 * 晚于阅读位置的改动由各查询按位置过滤，不在这里管阅读位置。
 *
 * 目标一律按锚认（anchor.ts）并对着套用前的数据集认，一条修订的改动不影响后面修订认目标；认不出的记为 stale、不套用。
 */

import type {Dataset, Entity, Knowledge, Mention, Question, Secret, Statement} from "../dataset";
import {displayName} from "../display-name";
import {comparePosition} from "../position";
import {resolveEntityAnchor, resolveStatementAnchor} from "./anchor";
import type {OverlayFile, Revision} from "./schema";

/** 一条修订套用的结果：`applied` 生效；`stale` 目标对不上锚；`inactive` 没有可改的（例如要确认的说法已经是确定的）。 */
export type Applied = "applied" | "stale" | "inactive";

export interface ApplyResult {
    dataset: Dataset;
    resolved: ReadonlyMap<string, Applied>;
}

/** 在套用时生效的修订：已采纳的与已驳回的；撤销了的、预留的待确认项不算。 */
export const isActive = (revision: Revision): boolean => revision.state === "adopted" || revision.state === "rejected";

/** 用户手动连接写出的说法（family 身份、旁白明说），`text` 里的名字取依据位置上的显示名。 */
export function linkStatement(a: Entity, b: Entity, revision: Extract<Revision, {op: "identity.link"}>): Statement {
    const at = revision.evidence;
    const word = revision.params.certainty === "certain" ? "就是" : "可能就是";
    return {
        id: revision.params.statement,
        text: `${displayName(a, at)}${word}${displayName(b, at)}。`,
        family: "identity",
        about: [a.id, b.id],
        source: {evidence: [{chapter: at.chapter, from: at.paragraph, to: at.paragraph}], channel: "narrator", by: null, to: [], mode: "assert"},
        kind: "fact",
        holder: null,
        basis: "explicit",
        premises: [],
        ...(revision.reason ? {reason: revision.reason} : {}),
        certainty: revision.params.certainty,
        neg: false,
        time: null,
        rel: [],
        revision: revision.id,
        at,
    };
}

export function applyOverlay(dataset: Dataset, file: OverlayFile | null): ApplyResult {
    const active = file?.items.filter(isActive) ?? [];
    if (active.length === 0) return {dataset, resolved: new Map()};

    const resolved = new Map<string, Applied>();
    const entityPatch = new Map<string, Entity>();
    const current = (entity: Entity): Entity => entityPatch.get(entity.id) ?? entity;
    let statements = dataset.statements;
    let mentions = dataset.mentions;
    const removed = new Set<string>();

    for (const revision of active) {
        const outcome = applyOne(revision);
        resolved.set(revision.id, outcome);
    }

    function applyOne(revision: Revision): Applied {
        switch (revision.op) {
            case "identity.confirm": {
                const target = resolveStatementAnchor(dataset, revision.anchors[0]!);
                if (!target) return "stale";
                const live = statements.find(statement => statement.id === target.id);
                if (!live || live.certainty !== "candidate") return "inactive";
                statements = statements.map(statement => (statement.id === target.id ? {...statement, certainty: "certain", revision: revision.id} : statement));
                return "applied";
            }
            case "identity.reject": {
                const target = resolveStatementAnchor(dataset, revision.anchors[0]!);
                if (!target) return "stale";
                if (!statements.some(statement => statement.id === target.id)) return "inactive";
                removed.add(target.id);
                statements = statements.filter(statement => statement.id !== target.id);
                return "applied";
            }
            case "identity.link": {
                const a = resolveEntityAnchor(dataset, revision.anchors[0]!);
                const b = resolveEntityAnchor(dataset, revision.anchors[1]!);
                if (!a || !b) return "stale";
                if (statements.some(statement => statement.id === revision.params.statement)) return "inactive";
                statements = [...statements, linkStatement(a, b, revision)];
                return "applied";
            }
            case "kind.set": {
                const target = resolveEntityAnchor(dataset, revision.anchors[0]!);
                if (!target) return "stale";
                const entity = current(target);
                const kindFrom = [...(entity.kindFrom ?? []), {at: revision.evidence, kind: revision.params.kind}].sort((x, y) => comparePosition(x.at, y.at));
                entityPatch.set(entity.id, {...entity, kindFrom});
                return "applied";
            }
            case "name.move": {
                const from = resolveEntityAnchor(dataset, revision.anchors[0]!);
                const to = resolveEntityAnchor(dataset, revision.anchors[1]!);
                if (!from || !to || from.id === to.id) return !from || !to ? "stale" : "inactive";
                const {text} = revision.params;
                const at = revision.evidence;
                const source = current(from);
                const target = current(to);
                const kept = source.names.filter(name => !(name.text === text && comparePosition(name.at, at) >= 0));
                const already = target.names.some(name => name.text === text && comparePosition(name.at, at) <= 0);
                entityPatch.set(source.id, {...source, names: kept});
                entityPatch.set(target.id, already ? target : {...target, names: [...target.names, {text, at, primary: false, note: "由修订挪入"}]});
                mentions = mentions.map(mention => (mention.entity === from.id && mention.text === text && comparePosition(mention.at, at) >= 0 ? ({...mention, entity: to.id} satisfies Mention) : mention));
                return "applied";
            }
        }
    }

    const entities = entityPatch.size === 0 ? dataset.entities : dataset.entities.map(entity => entityPatch.get(entity.id) ?? entity);
    const result: Dataset = {...dataset, entities, statements, mentions};
    return {dataset: removed.size === 0 ? result : dropReferences(result, removed), resolved};
}

/**
 * 说法被去掉之后，别的记录里指向它的引用一起清掉（docs/specs/story/revisions.md 输出 3：它在所有查询里不存在）：
 * 说法的 `premises` 与 `rel.to`、秘密的 `statements`、知情记录的 `about`（整条去掉）、悬念进展的 `answer`（去掉答案字段）。
 */
export function dropReferences(dataset: Dataset, removed: ReadonlySet<string>): Dataset {
    const statements: Statement[] = dataset.statements.map(statement =>
        statement.premises.some(id => removed.has(id)) || statement.rel.some(rel => removed.has(rel.to))
            ? {...statement, premises: statement.premises.filter(id => !removed.has(id)), rel: statement.rel.filter(rel => !removed.has(rel.to))}
            : statement,
    );
    const secrets: Secret[] = dataset.secrets.map(secret => (secret.statements.some(id => removed.has(id)) ? {...secret, statements: secret.statements.filter(id => !removed.has(id))} : secret));
    const knowledge: Knowledge[] = dataset.knowledge.filter(item => !removed.has(item.about));
    const questions: Question[] = dataset.questions.map(question =>
        question.updates.some(update => update.answer !== undefined && removed.has(update.answer))
            ? {...question, updates: question.updates.map(update => (update.answer !== undefined && removed.has(update.answer) ? withoutAnswer(update) : update))}
            : question,
    );
    return {...dataset, statements, secrets, knowledge, questions};
}

function withoutAnswer(update: Question["updates"][number]): Question["updates"][number] {
    const {answer: _answer, ...rest} = update;
    return rest;
}
