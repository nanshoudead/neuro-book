/**
 * 不剧透的统一出口：一次查询在阅读位置 P 的只读视图（docs/specs/story/queries.md 输出 1）。
 *
 * 查询只经 BookView 取数。视图按“深投影”给出记录：顶层成立位置晚于 P 的记录不出现；记录里自带位置的子项
 * （称呼、悬念进展、情节连接、延迟交代的钟点与日期）各按自己的位置过滤；指向不可见记录的引用整项省略。
 * 新增查询如果要用到某类记录里别的引用字段，先在这里补上过滤，不在查询里自己判断。
 *
 * 唯一的例外（P 所在章里 P 之后段落的原文）在 queries/source.ts 里单独处理，这里不给那些段落的任何记录。
 */

import type {BookIndex} from "./book-index";
import type {Arc, Beat, Entity, EntityName, Episode, Knowledge, LedgerEntry, Mention, Position, Question, Secret, SourceChapter, Statement, Summary, TimeAnchor} from "./dataset";
import {comparePosition, visibleAt} from "./position";

/** 已排好序的数组里成立位置不晚于 P 的前缀长度。 */
function visibleCount(records: readonly {at: Position}[], at: Position): number {
    let low = 0;
    let high = records.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (comparePosition(records[middle]!.at, at) <= 0) low = middle + 1;
        else high = middle;
    }
    return low;
}

export interface VisibleEntity extends Omit<Entity, "names"> {
    /** P 时可见的称呼，按出现先后。 */
    names: EntityName[];
}

export class BookView {
    readonly index: BookIndex;
    readonly at: Position;
    readonly #memo = new Map<string, unknown>();

    constructor(index: BookIndex, at: Position) {
        this.index = index;
        this.at = at;
    }

    visible(at: Position): boolean {
        return visibleAt(at, this.at);
    }

    /** 同一个视图里只算一次的派生结果（例如身份合并）。键由调用方保证不同用途不重名。 */
    cached<T>(key: string, build: () => T): T {
        if (this.#memo.has(key)) return this.#memo.get(key) as T;
        const value = build();
        this.#memo.set(key, value);
        return value;
    }

    #prefix<T extends {at: Position}>(records: readonly T[]): T[] {
        return records.slice(0, visibleCount(records, this.at));
    }

    #ids<T extends {id: string}>(key: string, records: () => readonly T[]): ReadonlyMap<string, T> {
        return this.cached(key, () => new Map(records().map(record => [record.id, record])));
    }

    /** P 所在章及之前各章的原文。 */
    get chapters(): SourceChapter[] {
        return this.cached("chapters", () => [...this.index.chapters.values()].filter(chapter => chapter.chapter <= this.at.chapter).sort((a, b) => a.chapter - b.chapter));
    }

    get entities(): VisibleEntity[] {
        return this.cached("entities", () =>
            this.#prefix(this.index.entities).map(entity => ({...entity, names: entity.names.filter(name => this.visible(name.at)).sort((a, b) => comparePosition(a.at, b.at))})),
        );
    }

    entity(id: string): VisibleEntity | undefined {
        return this.#ids("entityById", () => this.entities).get(id);
    }

    get statements(): Statement[] {
        return this.cached("statements", () => {
            const visibleIds = new Set(this.#prefix(this.index.statements).map(statement => statement.id));
            return this.#prefix(this.index.statements).map(statement => {
                const projected: Statement = {
                    ...statement,
                    about: statement.about.filter(id => this.entity(id) !== undefined),
                    premises: statement.premises.filter(id => visibleIds.has(id)),
                    rel: statement.rel.filter(rel => visibleIds.has(rel.to)),
                };
                if (statement.secret !== undefined && !this.#visibleSecretIds.has(statement.secret)) delete projected.secret;
                return projected;
            });
        });
    }

    statement(id: string): Statement | undefined {
        return this.#ids("statementById", () => this.statements).get(id);
    }

    get #visibleSecretIds(): ReadonlySet<string> {
        return this.cached("visibleSecretIds", () => new Set(this.#prefix(this.index.secrets).map(secret => secret.id)));
    }

    get secrets(): Secret[] {
        return this.cached("secrets", () =>
            this.#prefix(this.index.secrets).map(secret => ({
                ...secret,
                about: secret.about.filter(id => this.entity(id) !== undefined),
                statements: secret.statements.filter(id => this.statement(id) !== undefined),
            })),
        );
    }

    secret(id: string): Secret | undefined {
        return this.#ids("secretById", () => this.secrets).get(id);
    }

    /** 知情记录；所指的说法或秘密还不可见的整条不给。 */
    get knowledge(): Knowledge[] {
        return this.cached("knowledge", () => this.#prefix(this.index.knowledge).filter(item => this.statement(item.about) !== undefined || this.secret(item.about) !== undefined));
    }

    knowledgeItem(id: string): Knowledge | undefined {
        return this.#ids("knowledgeById", () => this.knowledge).get(id);
    }

    /** 某人对某个说法或秘密的可见知情记录，按位置先后。 */
    knowledgeOf(who: string, about: string): Knowledge[] {
        const all = this.index.knowledgeByWhoAbout.get(`${who}|${about}`) ?? [];
        return all.slice(0, visibleCount(all, this.at)).filter(item => this.statement(item.about) !== undefined || this.secret(item.about) !== undefined);
    }

    get episodes(): Episode[] {
        return this.cached("episodes", () => {
            const visibleIds = new Set(this.#prefix(this.index.episodes).map(episode => episode.id));
            return this.#prefix(this.index.episodes).map(episode => ({
                ...episode,
                // 真身或出场身份有一个可见就留下；落到哪个点由查询按分组决定（queries/context.ts 的 participant）。
                who: episode.who.filter(member => this.entity(member.e) !== undefined || (member.as !== undefined && this.entity(member.as) !== undefined)),
                links: episode.links.filter(link => this.visible(link.at) && visibleIds.has(link.to)),
            }));
        });
    }

    episode(id: string): Episode | undefined {
        return this.#ids("episodeById", () => this.episodes).get(id);
    }

    get questions(): Question[] {
        return this.cached("questions", () =>
            this.#prefix(this.index.questions).map(question => ({
                ...question,
                about: question.about.filter(id => this.entity(id) !== undefined),
                updates: question.updates
                    .filter(update => this.visible(update.at))
                    .map(update => {
                        if (update.answer === undefined || this.statement(update.answer) !== undefined) return update;
                        const {answer: _hidden, ...rest} = update;
                        return rest;
                    }),
            })),
        );
    }

    question(id: string): Question | undefined {
        return this.#ids("questionById", () => this.questions).get(id);
    }

    get times(): TimeAnchor[] {
        return this.cached("times", () => {
            const visibleIds = new Set(this.#prefix(this.index.times).map(time => time.id));
            return this.#prefix(this.index.times).map(time => {
                const projected: TimeAnchor = {...time, rel: time.rel.filter(rel => visibleIds.has(rel.to))};
                if (time.clock !== undefined && !this.visible(time.clockAt ?? time.at)) delete projected.clock;
                if (time.date !== undefined && !this.visible(time.dateAt ?? time.at)) delete projected.date;
                return projected;
            });
        });
    }

    time(id: string): TimeAnchor | undefined {
        return this.#ids("timeById", () => this.times).get(id);
    }

    /** 段落概要：成立位置就是它所概括范围的最后一段，可见即整段范围都可见（输出 14）。 */
    get beats(): Beat[] {
        return this.cached("beats", () => this.#prefix(this.index.beats).map(beat => (beat.time !== null && this.time(beat.time) === undefined ? {...beat, time: null} : beat)));
    }

    get ledger(): LedgerEntry[] {
        return this.cached("ledger", () =>
            this.#prefix(this.index.ledger).map(entry => {
                if (entry.item === undefined || this.entity(entry.item) !== undefined) return entry;
                const {item: _hidden, ...rest} = entry;
                return rest;
            }),
        );
    }

    ledgerEntry(id: string): LedgerEntry | undefined {
        return this.#ids("ledgerById", () => this.ledger).get(id);
    }

    get summaries(): Summary[] {
        return this.cached("summaries", () => this.#prefix(this.index.summaries));
    }

    /** 当前这一批主线：P 之前归纳到的章数最大的那一批（输出 13）；情节只留可见的。 */
    get arcs(): {through: number | null; arcs: Arc[]} {
        return this.cached("arcs", () => {
            const visible = this.#prefix(this.index.arcs);
            if (visible.length === 0) return {through: null, arcs: []};
            const through = Math.max(...visible.map(arc => arc.through));
            return {
                through,
                arcs: visible.filter(arc => arc.through === through).map(arc => ({...arc, episodes: arc.episodes.filter(id => this.episode(id) !== undefined)})),
            };
        });
    }

    get mentions(): Mention[] {
        return this.cached("mentions", () => this.#prefix(this.index.mentions).filter(mention => this.entity(mention.entity) !== undefined));
    }
}
