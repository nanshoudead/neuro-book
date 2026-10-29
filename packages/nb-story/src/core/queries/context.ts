/**
 * 书级查询共用的上下文与小工具。每次调用由 api.ts 建一份：固定的一代、阅读位置的视图、视角的分组与分页。
 */

import type {NodeRef, StoryMethod, Tags} from "../../contract/contract";
import type {BookIndex} from "../book-index";
import {paginate} from "../cursor";
import type {Basis, Episode, KnowledgeState, Position, Span, Statement, StatementKind} from "../dataset";
import {READER, type Grouping} from "../identity";
import {formatSpan} from "../position";
import type {BookView} from "../projection";
import {episodeTier, type Tier} from "../tiers";

export interface QueryContext {
    readonly method: StoryMethod;
    readonly index: BookIndex;
    readonly view: BookView;
    /** 这次调用的视角分组；不适用视角的方法拿到读者视角。 */
    readonly grouping: Grouping;
    /** 按调用参数里的 cursor、limit 取一页。 */
    page<T>(items: readonly T[]): {items: T[]; total: number; next: string | null};
    /** 把调用参数里的对象（id、名字或称呼）解析成这次视角分组里的点 id；见 api.ts 的 resolveEntity。 */
    resolveEntity(text: string): string;
}

/** 角色视角能用的说法：他在 P 时最新的知情为知道、读到、听说或认为（输出 5）。 */
const PERSPECTIVE_STATES: ReadonlySet<KnowledgeState> = new Set(["knows", "read", "heard", "believes"]);

/**
 * 这次视角能用的说法（docs/specs/story/queries.md 输出 5 第 2 条）：读者视角是全部可见说法，角色视角只有他知道、
 * 读到、听说或认为的。关系图、人物卡的条数与说法列表都用这一份，同一视角下各处的知识边界一致。
 */
export function perspectiveStatements(ctx: QueryContext): Statement[] {
    const {view, grouping} = ctx;
    return view.cached(`statements:${grouping.perspective}`, () => {
        if (grouping.perspective === READER) return view.statements;
        return view.statements.filter(statement => {
            for (const who of grouping.self) {
                const latest = view.knowledgeOf(who, statement.id).at(-1);
                if (latest && PERSPECTIVE_STATES.has(latest.state)) return true;
            }
            return false;
        });
    });
}

export function makePager(generation: string, digest: string, cursor: string | undefined, limit: number | undefined): QueryContext["page"] {
    return items => paginate(items, {generation, digest, cursor, limit});
}

export function refs(spans: readonly Span[]): string[] {
    return spans.map(formatSpan);
}

/** 记录的第一个出处；没有出处时退回它成立的那一段。 */
export function firstRef(spans: readonly Span[], at: Position): string {
    return spans[0] ? formatSpan(spans[0]) : `${at.chapter}.${at.paragraph}`;
}

export function tags(kind: StatementKind | null, basis: Basis): Tags {
    return {kind, inferred: basis === "inferred"};
}

/** 对象在这个分组下所在的点；对象不可见时为 null。 */
export function nodeRef(grouping: Grouping, entityId: string): NodeRef | null {
    const node = grouping.nodeOf.get(entityId);
    return node === undefined ? null : {id: node, label: grouping.labels.get(node)!};
}

/** 一组对象各自所在的点，去重、保持先后。 */
export function nodeRefs(grouping: Grouping, entityIds: Iterable<string>): NodeRef[] {
    const seen = new Set<string>();
    const result: NodeRef[] = [];
    for (const id of entityIds) {
        const ref = nodeRef(grouping, id);
        if (ref && !seen.has(ref.id)) {
            seen.add(ref.id);
            result.push(ref);
        }
    }
    return result;
}

/** 一个对象自己的名字：P 时可见的最后一个主名，没有就取第一个可见称呼，再没有用它的说明标签。 */
export function entityName(view: BookView, entityId: string): string {
    const entity = view.entity(entityId);
    if (!entity) return entityId;
    return entity.names.filter(name => name.primary).at(-1)?.text ?? entity.names[0]?.text ?? entity.label;
}

/**
 * 情节参与者在这次分组里落到的点（docs/specs/story/queries.md 输出 1、13）。数据里 `as` 记着他以哪个身份出场
 * （例如南小风以风信子出场）：分组已把真身与化名合成一个点时，取这个点并写出化名；还没合并时只取化名的点，不借
 * 参与者名单暴露真身。化名不可见时退回真身。
 */
export function participant(ctx: QueryContext, member: Episode["who"][number]): {node: NodeRef; as: string | null} | null {
    const self = nodeRef(ctx.grouping, member.e);
    const persona = member.as !== undefined && member.as !== member.e ? nodeRef(ctx.grouping, member.as) : null;
    if (persona === null) return self && {node: self, as: null};
    if (self === null || self.id !== persona.id) return {node: persona, as: null};
    // 化名没有可见称呼（只有抽取时的说明），或者就是这个点的显示名时，不另写。
    const name = (ctx.view.entity(member.as!)?.names.length ?? 0) > 0 ? entityName(ctx.view, member.as!) : null;
    return {node: self, as: name === null || name === self.label ? null : name};
}

/** 一段情节的参与者：去重、保持先后；同一个点出现几次时取第一个写了化名的。 */
export function participants(ctx: QueryContext, episode: Episode): (NodeRef & {as: string | null})[] {
    const result: (NodeRef & {as: string | null})[] = [];
    for (const member of episode.who) {
        const found = participant(ctx, member);
        if (!found) continue;
        const existing = result.find(item => item.id === found.node.id);
        if (!existing) result.push({...found.node, as: found.as});
        else if (existing.as === null) existing.as = found.as;
    }
    return result;
}

/** 一段情节的参与者所在的点 id。 */
export function participantNodes(ctx: QueryContext, episode: Episode): string[] {
    return participants(ctx, episode).map(item => item.id);
}

/** 情节的简要条目（人物卡、关系详情、悬念里的情节）；`tier` 是先验等级。 */
export function episodeBrief(episode: Episode): {id: string; title: string; chapter: number; refs: string[]; tier: Tier | null} {
    return {id: episode.id, title: episode.title, chapter: episode.at.chapter, refs: refs(episode.evidence), tier: episodeTier(episode)};
}

/** 搜索用的“包含这段文字”：忽略大小写与首尾空白。 */
export function matches(text: string, query: string | undefined): boolean {
    if (query === undefined || query.trim() === "") return true;
    return text.toLowerCase().includes(query.trim().toLowerCase());
}

export function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
