/**
 * 两个对象之间的关系：`entity.relations`（这个人和每个对象的关系一览）、`entity.relation`（两人之间的全部说法、
 * 同场的情节与互相知道的事）。docs/specs/story/queries.md 输出 20、21。
 *
 * “两人之间”按这次视角的分组算：说法的 about 落到两个点上、情节的参与者落到两个点上（参与者按 participant 解析，
 * 不借化名暴露真身）、知情记录的人在一个点而它所指说法的 about 含另一个点。认知只在读者视角给，和关系图一致。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import type {Episode, Knowledge, Statement} from "../dataset";
import {READER} from "../identity";
import {episodeBrief, firstRef, nodeRef, participantNodes, perspectiveStatements, refs, tags, type QueryContext} from "./context";
import {relationWord} from "./graph";

const RELATION_FAMILIES: ReadonlySet<string> = new Set(["kinship", "social", "membership"]);
/** 两人之间互相知道的事，各列最近的几条。 */
const KNOWS_SHOWN = 20;
const STRENGTH_ORDER = ["identity", "relation", "attitude", "statement", "together", "knows"] as const;
type Strength = (typeof STRENGTH_ORDER)[number];

interface Pair {
    statements: Statement[];
    episodes: Episode[];
    /** 这个人知道的、关于对方的；对方知道的、关于这个人的。 */
    ab: Knowledge[];
    ba: Knowledge[];
}

function emptyPair(): Pair {
    return {statements: [], episodes: [], ab: [], ba: []};
}

/** 这个点和每个别的点之间的说法、同场情节与认知。 */
export function relationPairs(ctx: QueryContext, node: string): Map<string, Pair> {
    const {view, grouping} = ctx;
    const pairs = new Map<string, Pair>();
    const pairOf = (other: string) => {
        let pair = pairs.get(other);
        if (!pair) pairs.set(other, (pair = emptyPair()));
        return pair;
    };
    const nodesOf = (ids: readonly string[]) => new Set(ids.map(id => grouping.nodeOf.get(id)).filter((id): id is string => id !== undefined));
    for (const statement of perspectiveStatements(ctx)) {
        const nodes = nodesOf(statement.about);
        if (!nodes.has(node)) continue;
        for (const other of nodes) if (other !== node) pairOf(other).statements.push(statement);
    }
    for (const episode of view.episodes) {
        const nodes = participantNodes(ctx, episode);
        if (!nodes.includes(node)) continue;
        for (const other of nodes) if (other !== node) pairOf(other).episodes.push(episode);
    }
    if (grouping.perspective === READER) {
        for (const item of view.knowledge) {
            const who = grouping.nodeOf.get(item.who);
            const statement = view.statement(item.about);
            if (who === undefined || !statement) continue;
            const targets = nodesOf(statement.about);
            if (who === node) {
                for (const other of targets) if (other !== node) pairOf(other).ab.push(item);
            } else if (targets.has(node)) {
                pairOf(who).ba.push(item);
            }
        }
    }
    for (const pair of grouping.identity) {
        if (pair.a === node) pairOf(pair.b);
        else if (pair.b === node) pairOf(pair.a);
    }
    return pairs;
}

function identityBetween(ctx: QueryContext, a: string, b: string) {
    return ctx.grouping.identity.find(pair => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a))?.identity ?? null;
}

/** 身份连接只在两头都是人物（或人物的身份）时算最强的一类：数据里偶尔有把人和“反派魔法少女”这类概念连成同一身份的。 */
const PERSON_KINDS: ReadonlySet<string> = new Set(["person", "persona"]);

function strengthOf(pair: Pair, identity: unknown, personPair: boolean): Strength {
    if (identity !== null && personPair) return "identity";
    if (pair.statements.some(statement => RELATION_FAMILIES.has(statement.family))) return "relation";
    if (pair.statements.some(statement => statement.family === "attitude")) return "attitude";
    if (pair.statements.length > 0) return "statement";
    if (pair.episodes.length > 0) return "together";
    if (identity !== null) return "identity";
    return "knows";
}

/**
 * 最能说明这段关系的一句（说法按出处先后排好）：只涉及这两人的说法优先，免得几个人共用一句“南小风认为南嘉鱼有苏天晴的
 * 联系方式”；同一组里最近的关系说法 → 最近的态度说法 → 最近的一条。
 */
function summaryOf(ctx: QueryContext, node: string, other: string, statements: readonly Statement[]): StoryResult<"entity.relations">["items"][number]["summary"] {
    const onlyTwo = statements.filter(statement => statement.about.every(id => {
        const at = ctx.grouping.nodeOf.get(id);
        return at === undefined || at === node || at === other;
    }));
    const choose = (list: readonly Statement[]) => list.filter(statement => RELATION_FAMILIES.has(statement.family)).at(-1)
        ?? list.filter(statement => statement.family === "attitude").at(-1)
        ?? list.at(-1);
    const pick = choose(onlyTwo) ?? choose(statements);
    if (!pick) return null;
    return {text: pick.text, family: pick.family, holder: pick.holder === null ? null : nodeRef(ctx.grouping, pick.holder), ref: firstRef(pick.source.evidence, pick.at), chapter: pick.at.chapter};
}

export function entityRelations(ctx: QueryContext, params: StoryParams<"entity.relations">): StoryResult<"entity.relations"> {
    const {view, grouping} = ctx;
    const node = ctx.resolveEntity(params.entity);
    const reader = grouping.perspective === READER;
    const items = [...relationPairs(ctx, node)].map(([other, pair]) => {
        const identity = identityBetween(ctx, node, other);
        const relationStatements = pair.statements.filter(statement => RELATION_FAMILIES.has(statement.family));
        const kind = view.entity(other)!.kind;
        const last = pair.episodes.at(-1);
        return {
            other: {id: other, label: grouping.labels.get(other)!, kind},
            strength: strengthOf(pair, identity, PERSON_KINDS.has(kind) && PERSON_KINDS.has(view.entity(node)!.kind)),
            word: relationStatements.length ? relationWord(relationStatements) : null,
            identity,
            counts: {statements: pair.statements.length, episodes: pair.episodes.length, knows: reader ? {ab: pair.ab.length, ba: pair.ba.length} : null},
            summary: summaryOf(ctx, node, other, pair.statements),
            lastEpisode: last ? {id: last.id, title: last.title, chapter: last.at.chapter} : null,
        };
    });
    const weight = (item: (typeof items)[number]) => item.counts.statements * 3 + item.counts.episodes + (item.counts.knows ? item.counts.knows.ab + item.counts.knows.ba : 0);
    items.sort((a, b) => STRENGTH_ORDER.indexOf(a.strength) - STRENGTH_ORDER.indexOf(b.strength) || weight(b) - weight(a) || (a.other.id < b.other.id ? -1 : 1));
    return {items};
}

export function entityRelation(ctx: QueryContext, params: StoryParams<"entity.relation">): StoryResult<"entity.relation"> {
    const {grouping} = ctx;
    const a = ctx.resolveEntity(params.entity);
    const b = ctx.resolveEntity(params.other);
    const pair = relationPairs(ctx, a).get(b) ?? emptyPair();
    const relationStatements = pair.statements.filter(statement => RELATION_FAMILIES.has(statement.family));
    const knowsItem = (item: Knowledge) => ({text: ctx.view.statement(item.about)!.text, state: item.state, how: item.how ?? null, refs: refs(item.evidence)});
    return {
        a: nodeRef(grouping, a)!,
        b: nodeRef(grouping, b)!,
        word: relationStatements.length ? relationWord(relationStatements) : null,
        identity: identityBetween(ctx, a, b),
        statements: pair.statements.map(statement => ({
            id: statement.id,
            text: statement.text,
            label: statement.label ?? null,
            family: statement.family,
            tags: tags(statement.kind, statement.basis),
            holder: statement.holder === null ? null : nodeRef(grouping, statement.holder),
            refs: refs(statement.source.evidence),
            chapter: statement.at.chapter,
        })),
        episodes: pair.episodes.map(episodeBrief),
        knows: grouping.perspective === READER ? {ab: pair.ab.slice(-KNOWS_SHOWN).map(knowsItem), ba: pair.ba.slice(-KNOWS_SHOWN).map(knowsItem)} : null,
    };
}
