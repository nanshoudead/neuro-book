/**
 * 身份合并与显示名：把可见的对象按视角合成“点”（docs/specs/story/queries.md 输出 3、4、5）。
 *
 * 点的 id 是它的代表对象：组成它的对象里第一个人物（person），没有人物时取最早出现的那个。这样合并了化名的人
 * 的点 id 是真人，人物卡、地址里的对象 id 在合并前后都能用。
 */

import type {IdentityLink} from "./book-index";
import type {Entity, KnowledgeState} from "./dataset";
import type {IdentityState} from "../contract/contract";
import {formatSpan} from "./position";
import type {BookView, VisibleEntity} from "./projection";

export const READER = "reader";

/** 角色视角下，读者合并、角色不合并的两点。 */
export interface UnmergedPair {
    a: string;
    b: string;
    identity: IdentityState;
}

export interface Grouping {
    /** "reader"，或视角人物的点 id。 */
    readonly perspective: string;
    /** 视角人物组成点的对象；读者视角为空。 */
    readonly self: ReadonlySet<string>;
    /** 可见对象 → 所在点的 id。 */
    readonly nodeOf: ReadonlyMap<string, string>;
    /** 点 id → 组成它的对象 id（按出现先后）。 */
    readonly members: ReadonlyMap<string, readonly string[]>;
    /** 点 id → 显示名（已按输出 4 区分重名）。 */
    readonly labels: ReadonlyMap<string, string>;
    /** 点 id → P 之前出场（称呼被找到）的次数。 */
    readonly mentions: ReadonlyMap<string, number>;
    /** 两点之间的身份连接状态：读者视角下只有不确定连接（uncertain）；角色视角下是读者合并而他不合并的。 */
    readonly identity: readonly UnmergedPair[];
    /** 合并进点里的对象各由哪条连接连进来（第一条成立的），给人物卡的“同一身份”用。 */
    readonly joinedBy: ReadonlyMap<string, IdentityLink>;
}

class UnionFind {
    readonly #parent = new Map<string, string>();

    find(id: string): string {
        let root = id;
        while (this.#parent.has(root) && this.#parent.get(root) !== root) root = this.#parent.get(root)!;
        let current = id;
        while (current !== root) {
            const next = this.#parent.get(current) ?? root;
            this.#parent.set(current, root);
            current = next;
        }
        return root;
    }

    union(a: string, b: string): boolean {
        const left = this.find(a);
        const right = this.find(b);
        if (left === right) return false;
        this.#parent.set(right, left);
        return true;
    }
}

const AWARE_MERGE: ReadonlySet<KnowledgeState> = new Set(["knows", "read"]);

/** 可见的身份连接：说法可见、两端对象可见。 */
function visibleLinks(view: BookView): IdentityLink[] {
    return view.index.identityLinks.filter(link => view.statement(link.statement.id) !== undefined && view.entity(link.a) !== undefined && view.entity(link.b) !== undefined);
}

/**
 * 某人（几个对象组成的一个人）在 P 时对一条身份连接最新的知情状态：看他对这条说法、对它所属秘密的知情记录，
 * 取位置最晚的一条；同一位置两种都有时以对秘密的为准。没有任何记录时为 null。
 */
export function awarenessOfLink(view: BookView, who: Iterable<string>, link: IdentityLink): {state: KnowledgeState; at: string} | null {
    let best: {state: KnowledgeState; chapter: number; paragraph: number; secret: boolean; at: string} | null = null;
    for (const person of who) {
        const records = [...view.knowledgeOf(person, link.statement.id).map(item => ({item, secret: false})), ...(link.secret ? view.knowledgeOf(person, link.secret).map(item => ({item, secret: true})) : [])];
        for (const {item, secret} of records) {
            const later = best === null || item.at.chapter > best.chapter || (item.at.chapter === best.chapter && (item.at.paragraph > best.paragraph || (item.at.paragraph === best.paragraph && secret && !best.secret)));
            if (later) best = {state: item.state, chapter: item.at.chapter, paragraph: item.at.paragraph, secret, at: item.evidence[0] ? formatSpan(item.evidence[0]) : `${item.at.chapter}.${item.at.paragraph}`};
        }
    }
    return best ? {state: best.state, at: best.at} : null;
}

function representative(members: readonly VisibleEntity[]): VisibleEntity {
    return members.find(entity => entity.kind === "person") ?? members[0]!;
}

/** 点的显示名（还没区分重名）：代表对象最新的可见主名 → 其它成员的主名 → P 之前出现最多的称呼 → “未具名身份”。 */
function baseLabel(members: readonly VisibleEntity[], rep: VisibleEntity, mentionCounts: ReadonlyMap<string, Map<string, number>>): string {
    for (const entity of [rep, ...members.filter(member => member !== rep)]) {
        const primary = entity.names.filter(name => name.primary).at(-1);
        if (primary) return primary.text;
    }
    let bestText: string | null = null;
    let bestCount = 0;
    for (const entity of members) {
        for (const [text, count] of mentionCounts.get(entity.id) ?? []) {
            if (count > bestCount || (count === bestCount && bestText !== null && text < bestText)) {
                bestText = text;
                bestCount = count;
            }
        }
    }
    if (bestText) return bestText;
    for (const entity of [rep, ...members]) if (entity.names[0]) return entity.names[0].text;
    return "未具名身份";
}

const KIND_WORDS: Record<Entity["kind"], string> = {person: "人物", persona: "身份", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其它"};

/** 重名时次要的一个加的简短说明：对象的整理标签（截短），标签与名字相同时用类别。 */
function shortNote(entity: VisibleEntity, label: string): string {
    const text = entity.label.trim();
    if (text === "" || text === label) return KIND_WORDS[entity.kind];
    return text.length > 14 ? `${text.slice(0, 14)}…` : text;
}

function buildGrouping(view: BookView, perspective: string, union: (uf: UnionFind, links: IdentityLink[], self: ReadonlySet<string>) => UnmergedPair[] | null, self: ReadonlySet<string>): Grouping {
    const entities = view.entities;
    const uf = new UnionFind();
    const links = visibleLinks(view);
    const unmergedRaw = union(uf, links, self);

    const groups = new Map<string, VisibleEntity[]>();
    for (const entity of entities) {
        const root = uf.find(entity.id);
        const list = groups.get(root);
        if (list) list.push(entity);
        else groups.set(root, [entity]);
    }

    const mentionCounts = new Map<string, Map<string, number>>();
    for (const mention of view.mentions) {
        let byText = mentionCounts.get(mention.entity);
        if (!byText) mentionCounts.set(mention.entity, (byText = new Map()));
        byText.set(mention.text, (byText.get(mention.text) ?? 0) + 1);
    }

    const nodeOf = new Map<string, string>();
    const members = new Map<string, string[]>();
    const rawLabels = new Map<string, string>();
    const mentions = new Map<string, number>();
    const reps = new Map<string, VisibleEntity>();
    for (const list of groups.values()) {
        const rep = representative(list);
        reps.set(rep.id, rep);
        members.set(rep.id, list.map(entity => entity.id));
        for (const entity of list) nodeOf.set(entity.id, rep.id);
        rawLabels.set(rep.id, baseLabel(list, rep, mentionCounts));
        let count = 0;
        for (const entity of list) for (const value of mentionCounts.get(entity.id)?.values() ?? []) count += value;
        mentions.set(rep.id, count);
    }

    // 重名：出场最多的那个保留原名，其余的加简短说明。
    const byLabel = new Map<string, string[]>();
    for (const [id, label] of rawLabels) {
        const list = byLabel.get(label);
        if (list) list.push(id);
        else byLabel.set(label, [id]);
    }
    const labels = new Map<string, string>();
    for (const [label, ids] of byLabel) {
        const ordered = [...ids].sort((a, b) => (mentions.get(b)! - mentions.get(a)!) || (a < b ? -1 : 1));
        ordered.forEach((id, position) => labels.set(id, position === 0 ? label : `${label}（${shortNote(reps.get(id)!, label)}）`));
    }

    const joinedBy = new Map<string, IdentityLink>();
    for (const link of links) {
        if (nodeOf.get(link.a) !== nodeOf.get(link.b)) continue;
        for (const id of [link.a, link.b]) if (!joinedBy.has(id) && nodeOf.get(id) !== id) joinedBy.set(id, link);
    }

    const seen = new Set<string>();
    const identity: UnmergedPair[] = [];
    for (const pair of unmergedRaw ?? []) {
        const a = nodeOf.get(pair.a);
        const b = nodeOf.get(pair.b);
        if (!a || !b || a === b) continue;
        const [left, right] = a < b ? [a, b] : [b, a];
        const key = `${left}|${right}`;
        if (seen.has(key)) continue;
        seen.add(key);
        identity.push({a: left, b: right, identity: pair.identity});
    }

    return {perspective, self, nodeOf, members, labels, mentions, identity, joinedBy};
}

/** 读者视角：可见的确定身份连接合并（有传递性）；只有不确定连接的两点给 uncertain。 */
export function readerGrouping(view: BookView): Grouping {
    return view.cached("grouping:reader", () =>
        buildGrouping(
            view,
            READER,
            (uf, links) => {
                for (const link of links) if (link.certain) uf.union(link.a, link.b);
                return links.filter(link => !link.certain).map(link => ({a: link.a, b: link.b, identity: "uncertain" as const}));
            },
            new Set(),
        ),
    );
}

/**
 * 角色视角：视角人物自己的几个对象（读者视角下与他同一个点的）总是合并；别的确定连接，他此时知道或读到才合并。
 * 读者合并而他不合并的两点给他的知情状态，或 no-record。读者视角下也不确定的连接不给。
 */
export function characterGrouping(view: BookView, entityId: string): Grouping {
    const reader = readerGrouping(view);
    const node = reader.nodeOf.get(entityId);
    if (node === undefined) throw new Error(`视角对象 ${entityId} 在 P 时不可见`);
    return view.cached(`grouping:${node}`, () => {
        const self = new Set(reader.members.get(node) ?? []);
        return buildGrouping(
            view,
            node,
            (uf, links) => {
                const selfList = [...self];
                for (const id of selfList.slice(1)) uf.union(selfList[0]!, id);
                const unmerged: UnmergedPair[] = [];
                for (const link of links) {
                    if (!link.certain) continue;
                    if (self.has(link.a) && self.has(link.b)) continue;
                    const awareness = awarenessOfLink(view, self, link);
                    if (awareness && AWARE_MERGE.has(awareness.state)) uf.union(link.a, link.b);
                    else unmerged.push({a: link.a, b: link.b, identity: awareness ? (awareness.state as Exclude<KnowledgeState, "knows" | "read">) : "no-record"});
                }
                return unmerged;
            },
            self,
        );
    });
}

/** 按视角取分组：`"reader"` 或一个可见对象的 id（任一成员都行）。 */
export function groupingFor(view: BookView, perspective: string | undefined): Grouping {
    return perspective === undefined || perspective === READER ? readerGrouping(view) : characterGrouping(view, perspective);
}
