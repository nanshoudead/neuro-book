/**
 * 按一代与数据版本建的只读索引：查询要的查找表与按位置排好的数组。建一次约几十毫秒，按 (书 id, 代号, 版本) 缓存在进程里。
 *
 * 一次查询开始时用 openBookIndex 固定一代（Library.pinBook），之后一直用拿到的这份索引：删除、重新导入只会让以后
 * 的查询拿到新的一份，不影响已经拿到的（docs/specs/story/queries.md 的“时序与寿命”第 2 条）。
 *
 * 索引里是全书的记录，不按阅读位置过滤；查询不直接读这里的数组，只经 projection.ts 的视图取数。
 *
 * 唯一的改动是成立位置：每条记录的 `at` 取它自己的 `at` 与它全部出处终点里最晚的那个（悬念进展各算各的）。
 * 抽取管线给的 `at` 有时早于记录自己引用的原文（例如情节的步骤出处到后面几段才完），照原样用会在读到那几段之前
 * 就给出它们的内容（docs/specs/story/queries.md 输出 1）。
 */

import type {Arc, Beat, Dataset, Entity, Episode, Knowledge, LedgerEntry, Mention, Position, Question, Secret, SourceChapter, Span, Statement, Summary, TimeAnchor} from "./dataset";
import {StoryError} from "./errors";
import type {BookMeta, Library} from "./library";
import {readOverlay} from "./overlay/store";
import {applyOverlay} from "./overlay/apply";
import type {Applied} from "./overlay/apply";
import type {OverlayFile} from "./overlay/schema";
import {comparePosition} from "./position";

/** 带成立位置的记录。 */
interface Located {
    at: Position;
}

/** 一条记录对原文某一段的引用；`at` 是这次引用自己的成立位置（悬念进展、情节步骤可能晚于记录本身）。 */
export interface Citation {
    type: "statement" | "knowledge" | "episode" | "ledger" | "question" | "time";
    id: string;
    at: Position;
}

/** 两个对象之间的身份连接（docs/specs/story/queries.md 的“术语与参与者”）。 */
export interface IdentityLink {
    statement: Statement;
    a: string;
    b: string;
    /** 确定的身份连接：确定性为确定、且是旁白明说或角色认为。 */
    certain: boolean;
    /** 这条说法所属的身份秘密。 */
    secret: string | null;
}

export interface BookIndex {
    readonly meta: BookMeta;
    readonly dataset: Dataset;
    readonly chapters: ReadonlyMap<number, SourceChapter>;
    /** 以下数组都按 at 升序（同位置按 id），可见的部分是一个前缀。 */
    readonly entities: readonly Entity[];
    readonly statements: readonly Statement[];
    readonly secrets: readonly Secret[];
    readonly knowledge: readonly Knowledge[];
    readonly episodes: readonly Episode[];
    readonly questions: readonly Question[];
    readonly times: readonly TimeAnchor[];
    readonly beats: readonly Beat[];
    readonly ledger: readonly LedgerEntry[];
    readonly summaries: readonly Summary[];
    readonly arcs: readonly Arc[];
    readonly mentions: readonly Mention[];
    readonly identityLinks: readonly IdentityLink[];
    readonly entityById: ReadonlyMap<string, Entity>;
    readonly statementById: ReadonlyMap<string, Statement>;
    readonly secretById: ReadonlyMap<string, Secret>;
    readonly episodeById: ReadonlyMap<string, Episode>;
    readonly timeById: ReadonlyMap<string, TimeAnchor>;
    /** 说法 → 它所属的秘密（说法自己写了 secret，或被秘密列在 statements 里）。 */
    readonly secretOfStatement: ReadonlyMap<string, string>;
    /** 某人对某个说法或秘密的知情记录，键为 `${who}|${about}`，按 at 升序。 */
    readonly knowledgeByWhoAbout: ReadonlyMap<string, readonly Knowledge[]>;
    /** 原文每一段（键 `章.段`）被哪些记录引用；同一条记录对同一段只记一次。 */
    readonly citations: ReadonlyMap<string, readonly Citation[]>;
    /** 原文每一段（键 `章.段`）里程序找到的称呼。 */
    readonly mentionsByParagraph: ReadonlyMap<string, readonly Mention[]>;
    /** 用户的修订（story.revisions）：修订文件、每条的套用结果与套用之前的数据集（待确认列表要用原始记录）。 */
    readonly overlay: {readonly file: OverlayFile | null; readonly resolved: ReadonlyMap<string, Applied>; readonly original: Dataset};
}

function buildCitations(dataset: Dataset): Map<string, Citation[]> {
    const map = new Map<string, Citation[]>();
    const seen = new Set<string>();
    const cite = (type: Citation["type"], id: string, at: Position, spans: readonly Span[]) => {
        for (const span of spans) {
            for (let paragraph = span.from; paragraph <= span.to; paragraph += 1) {
                const key = `${span.chapter}.${paragraph}`;
                const unique = `${key}|${type}|${id}`;
                if (seen.has(unique)) continue;
                seen.add(unique);
                const list = map.get(key);
                const citation = {type, id, at};
                if (list) list.push(citation);
                else map.set(key, [citation]);
            }
        }
    };
    for (const statement of dataset.statements) cite("statement", statement.id, statement.at, statement.source.evidence);
    for (const item of dataset.knowledge) cite("knowledge", item.id, item.at, item.evidence);
    for (const episode of dataset.episodes) {
        cite("episode", episode.id, episode.at, episode.evidence);
        cite("episode", episode.id, episode.at, episode.steps.map(step => step.evidence));
    }
    for (const entry of dataset.ledger) cite("ledger", entry.id, entry.at, entry.evidence);
    for (const question of dataset.questions) {
        cite("question", question.id, question.at, question.evidence);
        for (const update of question.updates) cite("question", question.id, update.at, update.evidence);
    }
    for (const time of dataset.times) cite("time", time.id, time.at, time.evidence);
    for (const list of map.values()) list.sort((a, b) => comparePosition(a.at, b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return map;
}

function later(a: Position, b: Position): Position {
    return comparePosition(a, b) >= 0 ? a : b;
}

/** 记录的成立位置：自身位置与全部出处的终点里最晚的那个。 */
function settledAt(at: Position, spans: readonly Span[]): Position {
    let result = at;
    for (const span of spans) result = later(result, {chapter: span.chapter, paragraph: span.to});
    return result;
}

/** 按成立位置改写各类记录的 `at`（见模块头）。返回新的数据集，原数据不动。 */
function settle(dataset: Dataset): Dataset {
    return {
        ...dataset,
        statements: dataset.statements.map(statement => ({...statement, at: settledAt(statement.at, statement.source.evidence)})),
        knowledge: dataset.knowledge.map(item => ({...item, at: settledAt(item.at, item.evidence)})),
        episodes: dataset.episodes.map(episode => ({...episode, at: settledAt(episode.at, [...episode.evidence, ...episode.steps.map(step => step.evidence)])})),
        ledger: dataset.ledger.map(entry => ({...entry, at: settledAt(entry.at, entry.evidence)})),
        questions: dataset.questions.map(question => ({
            ...question,
            at: settledAt(question.at, question.evidence),
            updates: question.updates.map(update => ({...update, at: settledAt(update.at, update.evidence)})),
        })),
        times: dataset.times.map(time => ({...time, at: settledAt(time.at, time.evidence)})),
    };
}

function byPosition<T extends Located & ({id: string} | object)>(records: readonly T[]): T[] {
    return [...records].sort((a, b) => comparePosition(a.at, b.at) || compareId(a, b));
}

function compareId(a: object, b: object): number {
    const left = "id" in a && typeof a.id === "string" ? a.id : "";
    const right = "id" in b && typeof b.id === "string" ? b.id : "";
    return left < right ? -1 : left > right ? 1 : 0;
}

function indexBy<T extends {id: string}>(records: readonly T[]): Map<string, T> {
    return new Map(records.map(record => [record.id, record]));
}

/** 身份连接的判定只在这里：否定的身份说法（“不是同一个人”）不是连接；about 必须恰好是两个不同的已知对象。 */
function identityLinkOf(statement: Statement, entities: ReadonlyMap<string, Entity>, secretOf: ReadonlyMap<string, string>): IdentityLink | null {
    if (statement.family !== "identity" || statement.neg) return null;
    const [a, b] = statement.about;
    if (statement.about.length !== 2 || a === undefined || b === undefined || a === b || !entities.has(a) || !entities.has(b)) return null;
    const certain = statement.certainty === "certain" && (statement.kind === "fact" || statement.kind === "belief");
    return {statement, a, b, certain, secret: secretOf.get(statement.id) ?? null};
}

export function buildBookIndex(meta: BookMeta, original: Dataset, overlayFile: OverlayFile | null = null): BookIndex {
    const {dataset: raw, resolved} = applyOverlay(original, overlayFile);
    const dataset = settle(raw);
    const entities = byPosition(dataset.entities);
    const statements = byPosition(dataset.statements);
    const secrets = byPosition(dataset.secrets);
    const entityById = indexBy(entities);
    const secretOfStatement = new Map<string, string>();
    for (const secret of secrets) for (const id of secret.statements) secretOfStatement.set(id, secret.id);
    for (const statement of statements) if (statement.secret) secretOfStatement.set(statement.id, statement.secret);
    const knowledge = byPosition(dataset.knowledge);
    const knowledgeByWhoAbout = new Map<string, Knowledge[]>();
    for (const item of knowledge) {
        const key = `${item.who}|${item.about}`;
        const list = knowledgeByWhoAbout.get(key);
        if (list) list.push(item);
        else knowledgeByWhoAbout.set(key, [item]);
    }
    const identityLinks: IdentityLink[] = [];
    for (const statement of statements) {
        const link = identityLinkOf(statement, entityById, secretOfStatement);
        if (link) identityLinks.push(link);
    }
    const episodes = byPosition(dataset.episodes);
    const times = byPosition(dataset.times);
    const mentions = byPosition(dataset.mentions);
    const mentionsByParagraph = new Map<string, Mention[]>();
    for (const mention of mentions) {
        const key = `${mention.at.chapter}.${mention.at.paragraph}`;
        const list = mentionsByParagraph.get(key);
        if (list) list.push(mention);
        else mentionsByParagraph.set(key, [mention]);
    }
    return {
        meta,
        dataset,
        chapters: new Map(dataset.sources.map(chapter => [chapter.chapter, chapter])),
        entities,
        statements,
        secrets,
        knowledge,
        episodes,
        questions: byPosition(dataset.questions),
        times,
        beats: byPosition(dataset.beats),
        ledger: byPosition(dataset.ledger),
        summaries: byPosition(dataset.summaries),
        arcs: byPosition(dataset.arcs),
        mentions,
        identityLinks,
        entityById,
        statementById: indexBy(statements),
        secretById: indexBy(secrets),
        episodeById: indexBy(episodes),
        timeById: indexBy(times),
        secretOfStatement,
        knowledgeByWhoAbout,
        citations: buildCitations(dataset),
        mentionsByParagraph,
        overlay: {file: overlayFile, resolved, original},
    };
}

/** 缓存几代：同时开着几本书的服务也只留最近用过的几份。 */
const CACHE_LIMIT = 4;
const cache = new Map<string, BookIndex>();

/** 固定这本书当前的一代并取得它的索引（缓存里有就直接用）。 */
export async function openBookIndex(library: Library, bookId: string): Promise<BookIndex> {
    const pinned = await library.pinBook(bookId);
    try {
        // 修订文件在固定一代之后读，只认这一代的文件（overlay/store.ts）；它的版本进缓存键。
        // 修订文件的格式版本不认识时只读：按没有修订打开原来的图（写入类方法在 store 里得到 unsupported_format）。
        const overlay = await readOverlay(library.bookDir(bookId), pinned.meta.generation).catch((error: unknown) => {
            if (error instanceof StoryError && error.code === "unsupported_format") return null;
            throw error;
        });
        const key = `${library.root}\u0000${bookId}\u0000${pinned.meta.generation}\u0000${pinned.meta.revision}\u0000${overlay?.version ?? 0}`;
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            cache.set(key, cached);
            return cached;
        }
        const index = buildBookIndex(pinned.meta, await pinned.readDataset(), overlay);
        cache.set(key, index);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        return index;
    } finally {
        await pinned.release();
    }
}
