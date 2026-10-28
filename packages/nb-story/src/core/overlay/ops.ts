/**
 * 修订的写入方法（docs/specs/story/revisions.md 的方法表与失败码 R1 到 R5）：校验目标与依据位置、生成修订、写进修订文件。
 *
 * 校验对着套用之前的数据集做（目标是抽取出来的对象与说法），修订的目标记成锚（anchor.ts）。同一目标再次决定：与现有
 * 决定相同是空操作，不同的以后一个为准、先前的留在历史里（输出 10）。
 */

import {openBookIndex} from "../book-index";
import type {BookIndex} from "../book-index";
import type {Dataset, Entity, Position, Statement} from "../dataset";
import {displayName} from "../display-name";
import {StoryError} from "../errors";
import type {Library} from "../library";
import {formatPosition, parsePositionText} from "../position";
import {entityAnchor, resolveStatementAnchor, statementAnchor} from "./anchor";
import {applyOverlay} from "./apply";
import {isCandidateIdentity, listItems} from "./items";
import type {RevisionItem} from "./items";
import type {OverlayFile, Revision, RevisionSource} from "./schema";
import {writeOverlay} from "./store";
import type {OverlayWrite} from "./store";
import type {EntityKind} from "../dataset";
import {comparePosition} from "../position";

export interface RevisionResult {
    revision: RevisionItem;
    version: number;
}

type Rev = Revision;
const nowText = (): string => new Date().toISOString();

function nextId(file: OverlayFile): string {
    const numbers = file.items.map(item => /^r(\d+)$/u.exec(item.id)).filter((match): match is RegExpExecArray => match !== null).map(match => Number(match[1]));
    return `r${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

function nextLinkStatementId(file: OverlayFile): string {
    const numbers = file.items.flatMap(item => (item.op === "identity.link" ? [/^u(\d+)$/u.exec(item.params.statement)] : [])).filter((match): match is RegExpExecArray => match !== null).map(match => Number(match[1]));
    return `u${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

/** 依据位置：“章.段”，必须是已抽取的原文里真有的一段。 */
function parseEvidence(index: BookIndex, text: string): Position {
    const parsed = parsePositionText(text);
    if (!parsed || parsed.paragraph === undefined) throw new StoryError("evidence_invalid", `依据位置要写成“章.段”，例如 5.75：${text}`);
    const chapter = index.chapters.get(parsed.chapter);
    if (!chapter) throw new StoryError("evidence_invalid", `第 ${parsed.chapter} 章没有抽取（依据位置 ${text}）`);
    if (parsed.paragraph < 1 || parsed.paragraph > chapter.paragraphs.length) throw new StoryError("evidence_invalid", `第 ${parsed.chapter} 章没有第 ${parsed.paragraph} 段（共 ${chapter.paragraphs.length} 段）`);
    return {chapter: parsed.chapter, paragraph: parsed.paragraph};
}

/** 对象：写 id，或写一个在依据位置之前出现过的称呼；对应不止一个时报 `entity_ambiguous`。 */
function findEntity(dataset: Dataset, text: string, evidence: Position): Entity {
    const byId = dataset.entities.find(entity => entity.id === text);
    const found = byId ? [byId] : dataset.entities.filter(entity => entity.names.some(name => name.text === text && comparePosition(name.at, evidence) <= 0));
    if (found.length === 0) throw new StoryError("revision_target_not_found", `书里没有叫“${text}”的对象，或它在 ${formatPosition(evidence)} 之前还没出现`);
    if (found.length > 1) {
        throw new StoryError("entity_ambiguous", `“${text}”对应 ${found.length} 个对象，请改用 id：${found.map(entity => entity.id).join("、")}`, {candidates: found.map(entity => ({id: entity.id, label: displayName(entity, evidence), note: entity.label}))});
    }
    const entity = found[0]!;
    if (comparePosition(entity.at, evidence) > 0) throw new StoryError("revision_target_not_found", `对象 ${entity.id} 在 ${formatPosition(evidence)} 之前还没出现`);
    return entity;
}

function findStatement(dataset: Dataset, id: string): Statement {
    const statement = dataset.statements.find(item => item.id === id);
    if (!statement) throw new StoryError("revision_target_not_found", `书里没有说法 ${id}`);
    return statement;
}

/** 这条候选身份说法现有的决定（没有被撤销、锚还对得上的）。 */
function currentDecision(dataset: Dataset, file: OverlayFile, statement: Statement): Rev | undefined {
    return file.items.find(item => (item.op === "identity.confirm" || item.op === "identity.reject") && item.state !== "withdrawn" && resolveStatementAnchor(dataset, item.anchors[0]!)?.id === statement.id);
}

/** 指定位置生效的种类：抽取给的，加上已采纳的改种类修订。 */
function kindAt(entity: Entity, file: OverlayFile, at: Position): EntityKind {
    const changes = file.items.filter((item): item is Extract<Rev, {op: "kind.set"}> => item.op === "kind.set" && item.state === "adopted" && item.params.entity === entity.id && comparePosition(item.evidence, at) <= 0).sort((a, b) => comparePosition(a.evidence, b.evidence));
    return changes.at(-1)?.params.kind ?? entity.kind;
}

export type ReviseParams =
    | {method: "revisions.confirm" | "revisions.reject"; statement: string; reason?: string}
    | {method: "revisions.link"; a: string; b: string; evidence: string; certainty: "candidate" | "certain"}
    | {method: "revisions.kind"; entity: string; kind: EntityKind; evidence: string}
    | {method: "revisions.moveName"; text: string; from: string; to: string; evidence: string}
    | {method: "revisions.undo"; revision: string};

/** 写入类方法的入口。`book` 已解析成书 id。 */
export async function reviseBook(library: Library, bookId: string, params: ReviseParams): Promise<RevisionResult> {
    const index = await openBookIndex(library, bookId);
    const dir = await library.writableBook(bookId, index.meta.generation);
    const original = index.overlay.original;
    const {file} = await writeOverlay(dir, index.meta.generation, current => build(index, original, current, params));
    return {revision: await describe(index, original, file, params), version: file.version};
}

function build(index: BookIndex, original: Dataset, current: OverlayFile, params: ReviseParams): OverlayWrite<string> {
    const now = nowText();
    const base = (source: RevisionSource, evidence: Position, anchors: Rev["anchors"], partial: Pick<Rev, "state">) => ({id: nextId(current), source, by: "user" as const, evidence, anchors, createdAt: now, decidedAt: now, history: [{at: now, state: partial.state}], ...partial});
    const supersede = (old: Rev | undefined): Rev[] => current.items.map(item => (old && item.id === old.id ? ({...item, state: "withdrawn", history: [...item.history, {at: now, state: "withdrawn", note: "被后一个决定取代"}]} as Rev) : item));
    switch (params.method) {
        case "revisions.confirm":
        case "revisions.reject": {
            const statement = findStatement(original, params.statement);
            if (!isCandidateIdentity(statement)) throw new StoryError("revision_not_candidate", `说法 ${statement.id} 不是候选身份说法，不能${params.method === "revisions.confirm" ? "确认" : "驳回"}`);
            const op = params.method === "revisions.confirm" ? "identity.confirm" : "identity.reject";
            const old = currentDecision(original, current, statement);
            if (old?.op === op) return {items: current.items, result: old.id, unchanged: true};
            const at = {chapter: statement.at.chapter, paragraph: statement.at.paragraph};
            const revision = {...base(statement.origin === "persona-check" ? "persona-check" : "extraction", at, [statementAnchor(statement)], {state: op === "identity.confirm" ? "adopted" : "rejected"}), op, params: {statement: statement.id}, ...(params.reason ? {reason: params.reason} : {})} as Rev;
            return {items: [...supersede(old), revision], result: revision.id};
        }
        case "revisions.link": {
            const evidence = parseEvidence(index, params.evidence);
            const a = findEntity(original, params.a, evidence);
            const b = findEntity(original, params.b, evidence);
            if (a.id === b.id) throw new StoryError("revision_conflict", "要连的两个是同一个对象");
            const statement = nextLinkStatementId(current);
            const revision = {...base("user", evidence, [entityAnchor(a), entityAnchor(b)], {state: "adopted"}), op: "identity.link", params: {a: a.id, b: b.id, certainty: params.certainty, statement}} as Rev;
            return {items: [...current.items, revision], result: revision.id};
        }
        case "revisions.kind": {
            const evidence = parseEvidence(index, params.evidence);
            const entity = findEntity(original, params.entity, evidence);
            if (kindAt(entity, current, evidence) === params.kind) throw new StoryError("revision_conflict", `${displayName(entity, evidence)}在 ${formatPosition(evidence)} 已经是这个种类`);
            const revision = {...base("user", evidence, [entityAnchor(entity)], {state: "adopted"}), op: "kind.set", params: {entity: entity.id, kind: params.kind}} as Rev;
            return {items: [...current.items, revision], result: revision.id};
        }
        case "revisions.moveName": {
            const evidence = parseEvidence(index, params.evidence);
            const from = findEntity(original, params.from, evidence);
            const to = findEntity(original, params.to, evidence);
            if (from.id === to.id) throw new StoryError("revision_conflict", "称呼要挪给另一个对象");
            if (!from.names.some(name => name.text === params.text)) throw new StoryError("revision_target_not_found", `${displayName(from, evidence)}名下没有称呼“${params.text}”`);
            const revision = {...base("user", evidence, [entityAnchor(from), entityAnchor(to)], {state: "adopted"}), op: "name.move", params: {text: params.text, from: from.id, to: to.id}} as Rev;
            return {items: [...current.items, revision], result: revision.id};
        }
        case "revisions.undo": {
            const target = current.items.find(item => item.id === params.revision);
            if (!target) {
                if (/^st:/u.test(params.revision)) throw new StoryError("revision_conflict", "待确认与已自动关闭的项没有可撤销的决定");
                throw new StoryError("revision_not_found", `没有修订 ${params.revision}`);
            }
            if (target.state === "withdrawn") throw new StoryError("revision_conflict", `修订 ${target.id} 已经撤销过了`);
            const items = current.items.map(item => (item.id === target.id ? ({...item, state: "withdrawn", decidedAt: now, history: [...item.history, {at: now, state: "withdrawn", note: "用户撤销"}]} as Rev) : item));
            return {items, result: target.id};
        }
    }
}

/** 写入后的这条修订按列表的样子给出（全书位置）；撤销了的合成一项。 */
async function describe(index: BookIndex, original: Dataset, file: OverlayFile, params: ReviseParams): Promise<RevisionItem> {
    const {resolved} = applyOverlay(original, file);
    const listed = listItems(original, file, resolved, index.meta.extractedThrough);
    const touched = [...file.items].reverse().find(item => (params.method === "revisions.undo" ? item.id === params.revision : item.state !== "withdrawn"));
    if (params.method === "revisions.undo") {
        const target = file.items.find(item => item.id === params.revision)!;
        const statementId = target.op === "identity.confirm" || target.op === "identity.reject" ? target.params.statement : null;
        const back = statementId === null ? undefined : listed.items.find(item => item.id === `st:${statementId}`);
        if (back) return back;
        const fallback = listed.items.find(item => item.id === target.id);
        if (fallback) return {...fallback, state: "withdrawn", undoable: false};
        return {id: target.id, op: target.op, state: "withdrawn", source: target.source, by: target.by, summary: "", evidence: formatPosition(target.evidence), refs: [formatPosition(target.evidence)], decidedAt: target.decidedAt, undoable: false};
    }
    const mine = listed.items.find(item => item.id === touched?.id) ?? listed.items.find(item => item.id === `st:${(touched?.params as {statement?: string} | undefined)?.statement ?? ""}`);
    if (!mine) throw new Error(`写入的修订 ${touched?.id ?? "?"} 没有出现在列表里`);
    return mine;
}
