/**
 * 待确认列表与“已处理”（docs/specs/story/revisions.md 输出 7、8、15、16）。
 *
 * 输入是套用之前的数据集：套用之后，确认了的候选已经是确定的、驳回了的已经不存在，要给出原说法、出处与决定只能从原始
 * 记录与修订文件算。候选的状态现算、不写存储，优先级是 stale > 已有的决定 > closed > pending。
 */

import type {Dataset, Entity, Position, Statement} from "../dataset";
import {displayName} from "../display-name";
import {comparePosition, formatPosition, formatSpan, visibleAt} from "../position";
import type {Applied} from "./apply";
import type {OverlayFile, Revision, RevisionOp, RevisionSource} from "./schema";

/** `withdrawn` 只出现在写入方法的结果里（刚撤销的修订）；列表不列撤销了的。 */
export type ItemState = "pending" | "adopted" | "rejected" | "closed" | "stale" | "withdrawn";

export interface RevisionItem {
    /** 待确认与自动关闭的候选是 `st:<说法编号>`，有决定或用户自己的修订是 `r<n>`。 */
    id: string;
    op: RevisionOp | "identity.candidate";
    state: ItemState;
    source: RevisionSource;
    by: "user" | "auto" | null;
    summary: string;
    evidence: string;
    refs: string[];
    decidedAt: string | null;
    /** 能不能 `revisions.undo`：有决定的与用户自己的修订可以；待确认与自动关闭的不用。 */
    undoable: boolean;
}

export type ItemCounts = Record<Exclude<ItemState, "withdrawn">, number>;

export interface ItemList {
    items: RevisionItem[];
    counts: ItemCounts;
}

/** 说法的成立位置：自身位置与全部出处终点里最晚的（同 `book-index.ts` 的 `settle`）。 */
function settledAt(statement: Statement): Position {
    let at = statement.at;
    for (const span of statement.source.evidence) if (comparePosition({chapter: span.chapter, paragraph: span.to}, at) > 0) at = {chapter: span.chapter, paragraph: span.to};
    return at;
}

/** 候选身份说法：身份类、不是否定、恰好连两个不同对象、确定性为候选。 */
export function isCandidateIdentity(statement: Statement): boolean {
    return statement.family === "identity" && !statement.neg && statement.certainty === "candidate" && statement.about.length === 2 && statement.about[0] !== statement.about[1];
}

const pairKey = (statement: Statement): string => [...statement.about].sort().join("|");

/** 确定的身份说法（同 `book-index.ts` 的身份连接判定）。 */
function isCertainIdentity(statement: Statement): boolean {
    return statement.family === "identity" && !statement.neg && statement.certainty === "certain" && (statement.kind === "fact" || statement.kind === "belief") && statement.about.length === 2 && statement.about[0] !== statement.about[1];
}

const KIND_WORD: Record<Entity["kind"], string> = {person: "人物", persona: "马甲", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其他"};

export function listItems(dataset: Dataset, file: OverlayFile | null, resolved: ReadonlyMap<string, Applied>, at: Position): ItemList {
    const entities = new Map(dataset.entities.map(entity => [entity.id, entity]));
    const nameAt = (id: string, position: Position, fallback = id): string => {
        const entity = entities.get(id);
        return entity ? displayName(entity, position) : fallback;
    };
    const items: RevisionItem[] = [];
    const decided = new Map<string, Revision>();
    const stored = (file?.items ?? []).filter(revision => revision.state !== "withdrawn" && revision.state !== "pending");
    for (const revision of stored) {
        if ((revision.op === "identity.confirm" || revision.op === "identity.reject") && !isStaleRevision(revision, resolved)) decided.set(revision.params.statement, revision);
    }

    // 候选身份说法：有决定的、被后文确认的、还待确认的
    const certainPairs = new Set(dataset.statements.filter(isCertainIdentity).filter(statement => visibleAt(settledAt(statement), at)).map(pairKey));
    const sourceOf = (statement: Statement): RevisionSource => (statement.origin === "persona-check" ? "persona-check" : "extraction");
    const candidateIds = new Set<string>();
    for (const statement of dataset.statements) {
        if (!isCandidateIdentity(statement) || !visibleAt(settledAt(statement), at)) continue;
        candidateIds.add(statement.id);
        const decision = decided.get(statement.id);
        const base = {source: sourceOf(statement), summary: statement.text, evidence: formatPosition(settledAt(statement)), refs: statement.source.evidence.map(formatSpan)};
        if (decision) items.push({...base, id: decision.id, op: decision.op, state: decision.op === "identity.confirm" ? "adopted" : "rejected", by: decision.by, decidedAt: decision.decidedAt, undoable: true});
        else if (certainPairs.has(pairKey(statement))) items.push({...base, id: `st:${statement.id}`, op: "identity.candidate", state: "closed", by: null, decidedAt: null, undoable: false});
        else items.push({...base, id: `st:${statement.id}`, op: "identity.candidate", state: "pending", by: null, decidedAt: null, undoable: false});
    }

    // 修订文件里的项：对不上锚的是 stale；用户自己的修订；决定所指的候选在 P 还不可见时不列
    for (const revision of stored) {
        const outcome = resolved.get(revision.id);
        if (!visibleAt(revision.evidence, at)) continue;
        const isDecision = revision.op === "identity.confirm" || revision.op === "identity.reject";
        if (isDecision && outcome !== "stale") continue; // 已在候选循环里列出（所指候选不可见时它的证据位置也不可见）
        const base = {id: revision.id, op: revision.op, source: revision.source, by: revision.by, evidence: formatPosition(revision.evidence), refs: [formatPosition(revision.evidence)], decidedAt: revision.decidedAt, undoable: true};
        const state: ItemState = outcome === "stale" ? "stale" : revision.state === "rejected" ? "rejected" : "adopted";
        items.push({...base, state, summary: summaryOf(revision, nameAt)});
    }

    items.sort((x, y) => compareRef(x.evidence, y.evidence) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const counts: ItemCounts = {pending: 0, adopted: 0, rejected: 0, closed: 0, stale: 0};
    for (const item of items) if (item.state !== "withdrawn") counts[item.state] += 1;
    return {items, counts};
}

const isStaleRevision = (revision: Revision, resolved: ReadonlyMap<string, Applied>): boolean => resolved.get(revision.id) === "stale";

function compareRef(a: string, b: string): number {
    const [ac = 0, ap = 0] = a.split(".").map(Number);
    const [bc = 0, bp = 0] = b.split(".").map(Number);
    return ac - bc || ap - bp;
}

export function summaryOf(revision: Revision, nameAt: (id: string, at: Position, fallback?: string) => string): string {
    const at = revision.evidence;
    const anchorName = (index: number): string | undefined => {
        const anchor = revision.anchors[index];
        return anchor?.type === "entity" ? (anchor.firstName ?? anchor.id) : undefined;
    };
    switch (revision.op) {
        case "identity.confirm":
        case "identity.reject":
            return revision.anchors[0]?.type === "statement" ? revision.anchors[0].text : "";
        case "identity.link":
            return `${nameAt(revision.params.a, at, anchorName(0))}${revision.params.certainty === "certain" ? "就是" : "可能就是"}${nameAt(revision.params.b, at, anchorName(1))}。`;
        case "kind.set":
            return `把“${nameAt(revision.params.entity, at, anchorName(0))}”的种类改成${KIND_WORD[revision.params.kind]}`;
        case "name.move":
            return `把称呼“${revision.params.text}”从${nameAt(revision.params.from, at, anchorName(0))}挪给${nameAt(revision.params.to, at, anchorName(1))}`;
    }
}
