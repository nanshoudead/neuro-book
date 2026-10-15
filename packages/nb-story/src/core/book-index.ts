/**
 * 按一代建的只读索引：查询要的查找表与按位置排好的数组。建一次约几十毫秒，按 (书 id, 代号) 缓存在进程里。
 *
 * 一次查询开始时用 openBookIndex 固定一代（Library.pinBook），之后一直用拿到的这份索引：删除、重新导入只会让以后
 * 的查询拿到新的一份，不影响已经拿到的（docs/specs/story/queries.md 的“时序与寿命”第 2 条）。
 *
 * 索引里是全书的原始记录，不按阅读位置过滤；查询不直接读这里的数组，只经 projection.ts 的视图取数。
 */

import type {Arc, Beat, Dataset, Entity, Episode, Knowledge, LedgerEntry, Mention, Position, Question, Secret, SourceChapter, Statement, Summary, TimeAnchor} from "./dataset";
import type {BookMeta, Library} from "./library";
import {comparePosition} from "./position";

/** 带成立位置的记录。 */
interface Located {
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

export function buildBookIndex(meta: BookMeta, dataset: Dataset): BookIndex {
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
        mentions: byPosition(dataset.mentions),
        identityLinks,
        entityById,
        statementById: indexBy(statements),
        secretById: indexBy(secrets),
        episodeById: indexBy(episodes),
        timeById: indexBy(times),
        secretOfStatement,
        knowledgeByWhoAbout,
    };
}

/** 缓存几代：同时开着几本书的服务也只留最近用过的几份。 */
const CACHE_LIMIT = 4;
const cache = new Map<string, BookIndex>();

/** 固定这本书当前的一代并取得它的索引（缓存里有就直接用）。 */
export async function openBookIndex(library: Library, bookId: string): Promise<BookIndex> {
    const pinned = await library.pinBook(bookId);
    try {
        const key = `${library.root}\u0000${bookId}\u0000${pinned.meta.generation}`;
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            cache.set(key, cached);
            return cached;
        }
        const index = buildBookIndex(pinned.meta, await pinned.readDataset());
        cache.set(key, index);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        return index;
    } finally {
        await pinned.release();
    }
}
