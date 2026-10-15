/**
 * 对象：名册与人物卡，以及人物卡里的三个长列表（docs/specs/story/queries.md 输出 6、7、8）。
 */

import type {StoryParams, StoryResult} from "../../contract/contract";
import type {Facet} from "../dataset";
import {formatPosition, formatSpan} from "../position";
import type {VisibleEntity} from "../projection";
import {compareText, matches, nodeRef, refs, tags, type QueryContext} from "./context";
import {personSecretState} from "./secrets";

/** 名册里每个点列出的称呼个数。 */
const TOP_NAMES = 6;
/** 算“关系”条数用的说法类别。 */
const RELATION_FAMILIES = new Set(["kinship", "social", "membership"]);

function membersOf(ctx: QueryContext, node: string): VisibleEntity[] {
    return (ctx.grouping.members.get(node) ?? []).map(id => ctx.view.entity(id)!);
}

/** 点的全部可见称呼：同一写法只留第一次出现，按出场次数多到少、再按出现先后。 */
function namesOf(ctx: QueryContext, members: readonly VisibleEntity[]): {text: string; ref: string; count: number}[] {
    const counts = new Map<string, number>();
    const ids = new Set(members.map(member => member.id));
    for (const mention of ctx.view.mentions) if (ids.has(mention.entity)) counts.set(mention.text, (counts.get(mention.text) ?? 0) + 1);
    const first = new Map<string, {text: string; ref: string; order: number}>();
    let order = 0;
    for (const name of members.flatMap(member => member.names).sort((a, b) => a.at.chapter - b.at.chapter || a.at.paragraph - b.at.paragraph)) {
        if (!first.has(name.text)) first.set(name.text, {text: name.text, ref: formatPosition(name.at), order: order++});
    }
    return [...first.values()]
        .map(item => ({...item, count: counts.get(item.text) ?? 0}))
        .sort((a, b) => b.count - a.count || a.order - b.order)
        .map(({text, ref, count}) => ({text, ref, count}));
}

/** 调用参数里的对象 → 这次视角分组里的点。 */
function nodeFor(ctx: QueryContext, entity: string): string {
    const readerNode = ctx.resolveEntity(entity);
    return ctx.grouping.nodeOf.get(readerNode)!;
}

export function entitiesList(ctx: QueryContext, params: StoryParams<"entities.list">): StoryResult<"entities.list"> {
    const {grouping} = ctx;
    const rows = [...grouping.members.keys()]
        .map(node => {
            const members = membersOf(ctx, node);
            const names = namesOf(ctx, members);
            return {node, kind: ctx.view.entity(node)!.kind, members, names, label: grouping.labels.get(node)!, mentions: grouping.mentions.get(node)!};
        })
        .filter(row => params.kind === undefined || row.kind === params.kind)
        .filter(row => matches(row.label, params.query) || row.names.some(name => matches(name.text, params.query)))
        .sort((a, b) => b.mentions - a.mentions || compareText(a.node, b.node));
    return ctx.page(
        rows.map(row => ({
            id: row.node,
            label: row.label,
            kind: row.kind,
            mentions: row.mentions,
            names: {top: row.names.slice(0, TOP_NAMES).map(name => name.text), total: row.names.length},
            entities: row.members.map(member => member.id),
        })),
    );
}

export function entityCard(ctx: QueryContext, params: StoryParams<"entity.card">): StoryResult<"entity.card"> {
    const {view, grouping} = ctx;
    const node = nodeFor(ctx, params.entity);
    const members = membersOf(ctx, node);
    const ids = new Set(members.map(member => member.id));

    const latest = new Map<Facet, {through: number; items: string[]}>();
    for (const summary of view.summaries) {
        if (!ids.has(summary.entity)) continue;
        const current = latest.get(summary.facet);
        if (!current || summary.through >= current.through) latest.set(summary.facet, {through: summary.through, items: summary.items.map(item => item.text)});
    }

    const related = new Set<string>();
    for (const statement of view.statements) {
        if (!RELATION_FAMILIES.has(statement.family) || !statement.about.some(id => ids.has(id))) continue;
        for (const id of statement.about) {
            const other = grouping.nodeOf.get(id);
            if (other !== undefined && other !== node) related.add(other);
        }
    }

    return {
        id: node,
        label: grouping.labels.get(node)!,
        kind: view.entity(node)!.kind,
        entities: members.map(member => member.id),
        names: namesOf(ctx, members).map(({text, ref}) => ({text, ref})),
        identities: members
            .filter(member => member.id !== node)
            .map(member => {
                const link = grouping.joinedBy.get(member.id);
                const evidence = link?.statement.source.evidence[0];
                return {
                    id: member.id,
                    label: member.names.filter(name => name.primary).at(-1)?.text ?? member.names[0]?.text ?? member.label,
                    ref: evidence ? formatSpan(evidence) : link ? formatPosition(link.statement.at) : formatPosition(member.at),
                };
            }),
        facets: [...latest.entries()].map(([facet, value]) => ({facet, ...value})),
        secrets: view.secrets.map(secret => ({id: secret.id, title: secret.title, ...personSecretState(view, ids, secret)})),
        counts: {
            relations: related.size,
            knowledge: view.knowledge.filter(item => ids.has(item.who)).length,
            statements: view.statements.filter(statement => statement.about.some(id => ids.has(id))).length,
            episodes: view.episodes.filter(episode => episode.who.some(member => ids.has(member.e))).length,
        },
    };
}

export function entityKnowledge(ctx: QueryContext, params: StoryParams<"entity.knowledge">): StoryResult<"entity.knowledge"> {
    const {view} = ctx;
    const ids = new Set(ctx.grouping.members.get(nodeFor(ctx, params.entity)) ?? []);
    const items = view.knowledge
        .filter(item => ids.has(item.who) && (params.state === undefined || item.state === params.state))
        .map(item => {
            const statement = view.statement(item.about);
            const secret = statement ? undefined : view.secret(item.about);
            return {
                id: item.id,
                text: statement?.text ?? secret?.title ?? item.about,
                about: {type: statement ? ("statement" as const) : ("secret" as const), id: item.about},
                state: item.state,
                how: item.how ?? null,
                refs: refs(item.evidence),
                secret: secret !== undefined || (statement !== undefined && view.index.secretOfStatement.has(statement.id) && view.secret(view.index.secretOfStatement.get(statement.id)!) !== undefined),
                tags: tags(statement?.kind ?? null, item.basis),
                chapter: item.at.chapter,
            };
        })
        .filter(item => matches(item.text, params.query) || matches(item.how ?? "", params.query));
    return ctx.page(items);
}

export function entityStatements(ctx: QueryContext, params: StoryParams<"entity.statements">): StoryResult<"entity.statements"> {
    const ids = new Set(ctx.grouping.members.get(nodeFor(ctx, params.entity)) ?? []);
    const items = ctx.view.statements
        .filter(statement => statement.about.some(id => ids.has(id)) && matches(statement.text, params.query))
        .map(statement => ({
            id: statement.id,
            text: statement.text,
            family: statement.family,
            tags: tags(statement.kind, statement.basis),
            holder: statement.holder === null ? null : nodeRef(ctx.grouping, statement.holder),
            refs: refs(statement.source.evidence),
            chapter: statement.at.chapter,
        }));
    return ctx.page(items);
}

export function entityEpisodes(ctx: QueryContext, params: StoryParams<"entity.episodes">): StoryResult<"entity.episodes"> {
    const ids = new Set(ctx.grouping.members.get(nodeFor(ctx, params.entity)) ?? []);
    const items = ctx.view.episodes
        .filter(episode => episode.who.some(member => ids.has(member.e)) && (matches(episode.title, params.query) || matches(episode.summary, params.query)))
        .map(episode => ({id: episode.id, title: episode.title, chapter: episode.at.chapter, refs: refs(episode.evidence)}));
    return ctx.page(items);
}
