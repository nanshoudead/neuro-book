import type { Dataset, Entity, Episode, Knowledge, KnowledgeState, LedgerEntry, Mention, Position, Question, Secret, Span, Statement, Summary, TimeAnchor } from "./schema.ts";

// 这里的函数都只读数据集，不依赖运行环境，查看器和测试共用同一份。
// 每个查询都带“读到哪里”：只有这个位置之前出现的记录、称呼和判断才可见。

export const comparePosition = (a: Position, b: Position): number => a.chapter - b.chapter || a.paragraph - b.paragraph;
export const visible = (at: Position, readAt: Position): boolean => comparePosition(at, readAt) <= 0;
export const formatPosition = (at: Position): string => `${at.chapter}.${at.paragraph}`;
export const formatSpan = (span: Span): string => span.from === span.to ? `${span.chapter}.${span.from}` : `${span.chapter}.${span.from}-${span.to}`;

/** 对象在某个阅读位置的显示名：取此时最新的主要称呼；还没有称呼时用整理标签并加括号标明。 */
export function displayName(entity: Entity, readAt: Position): string {
    const names = entity.names.filter(name => visible(name.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
    const primary = names.filter(name => name.primary).at(-1);
    return primary?.text ?? names[0]?.text ?? `〔${entity.label}〕`;
}

const uniqueNames = new WeakMap<Dataset, { key: string; names: Map<string, string> }>();

/**
 * 对象在某个阅读位置的不重名显示名。
 * 此时可见的两个对象显示名相同时（一类东西和其中具体的一个、同名的两个人），各自带上整理标签，列表里才分得清。
 */
export function uniqueName(dataset: Dataset, entity: Entity, readAt: Position): string {
    const key = formatPosition(readAt);
    let cache = uniqueNames.get(dataset);
    if (cache?.key !== key) {
        const shown = dataset.entities.filter(item => visible(item.at, readAt)).map(item => [item, displayName(item, readAt)] as const);
        const counts = new Map<string, number>();
        for (const [, name] of shown) counts.set(name, (counts.get(name) ?? 0) + 1);
        cache = { key, names: new Map(shown.map(([item, name]) => [item.id, counts.get(name)! > 1 ? `${name}（${item.label}）` : name])) };
        uniqueNames.set(dataset, cache);
    }
    return cache.names.get(entity.id) ?? displayName(entity, readAt);
}

/** 时间点的钟点和日期在某个阅读位置能不能显示：它们可能比时间点本身交代得晚。 */
export function timeFacts(time: TimeAnchor, readAt: Position): { clock?: string; date?: string } {
    return {
        clock: time.clock !== undefined && visible(time.clockAt ?? time.at, readAt) ? time.clock : undefined,
        date: time.date !== undefined && visible(time.dateAt ?? time.at, readAt) ? time.date : undefined,
    };
}

export interface StatementStatus { confirmedBy: Statement[]; contradictedBy: Statement[]; revisedBy: Statement[] }

/** 一条说法在某个阅读位置是否已被后文印证、反驳或修正。 */
export function statementStatus(dataset: Dataset, statement: Statement, readAt: Position): StatementStatus {
    const later = dataset.statements.filter(item => visible(item.at, readAt) && item.rel.some(rel => rel.to === statement.id));
    const pick = (type: string) => later.filter(item => item.rel.some(rel => rel.to === statement.id && rel.type === type));
    return { confirmedBy: pick("confirms"), contradictedBy: pick("contradicts"), revisedBy: pick("revises") };
}

/** 某人对某个秘密或某条说法的知情记录，按原文先后排列。 */
function recordsFor(dataset: Dataset, who: string, targets: Set<string>, readAt: Position): Knowledge[] {
    return dataset.knowledge.filter(item => item.who === who && targets.has(item.about) && visible(item.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
}

const AWARE: ReadonlySet<KnowledgeState> = new Set(["knows", "believes", "read", "heard"]);

export interface IdentityGroup { members: string[]; via: Statement[] }

/**
 * 把“就是同一个”的对象归成一组。
 * viewer 是 reader 时按读者此时已确知的身份合并；是某个角色时，只合并这个角色知道的身份。
 * 这样角色的看法始终挂在他认识的那个身份上，不会把读者才知道的事算到角色头上。
 */
export function identityGroups(dataset: Dataset, readAt: Position, viewer: string = "reader"): IdentityGroup[] {
    const parent = new Map<string, string>();
    const find = (id: string): string => { const up = parent.get(id); if (!up || up === id) return id; const root = find(up); parent.set(id, root); return root; };
    const links: Statement[] = [];
    for (const item of dataset.statements) {
        if (item.family !== "identity" || item.neg || item.certainty !== "certain" || item.about.length !== 2 || !visible(item.at, readAt)) continue;
        if (viewer === "reader") {
            if (item.kind !== "fact") continue;
            const status = statementStatus(dataset, item, readAt);
            if ([...status.contradictedBy, ...status.revisedBy].some(other => other.kind === "fact")) continue;
        } else {
            const targets = new Set([item.id, ...(item.secret ? [item.secret] : [])]);
            const latest = recordsFor(dataset, viewer, targets, readAt).at(-1);
            if (!latest || !AWARE.has(latest.state)) continue;
        }
        const [a, b] = item.about as [string, string];
        parent.set(find(a), find(b));
        links.push(item);
    }
    const groups = new Map<string, IdentityGroup>();
    for (const entity of dataset.entities) {
        if (!visible(entity.at, readAt)) continue;
        const root = find(entity.id);
        const group = groups.get(root) ?? { members: [], via: [] };
        group.members.push(entity.id);
        groups.set(root, group);
    }
    for (const link of links) groups.get(find(link.about[0]!))?.via.push(link);
    return [...groups.values()].filter(group => group.members.length > 1);
}

export interface SecretRow {
    who: string;
    /** 此时的知情状态；none 表示没有任何记录，不等于不知道。 */
    state: KnowledgeState | "can-infer" | "none";
    since: Position | null;
    how?: string;
    basis: "explicit" | "inferred";
    history: Knowledge[];
}

/**
 * 某个秘密在某个阅读位置的知情表：读者一行，每个有记录的角色一行。
 * extra 里列出的角色即使没有记录也会出现在表里，标为“没有记录”。
 */
export function secretTable(dataset: Dataset, secret: Secret, readAt: Position, extra: string[] = []): SecretRow[] {
    const targets = new Set([secret.id, ...secret.statements]);
    const rows: SecretRow[] = [];
    const facts = secret.statements.map(id => dataset.statements.find(item => item.id === id)!).filter(item => item && visible(item.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
    const readerRecords = recordsFor(dataset, "reader", targets, readAt);
    const certain = facts.find(item => item.kind === "fact" && item.certainty === "certain" && item.basis === "explicit");
    const inferable = facts.find(item => item.kind === "fact");
    if (certain) rows.push({ who: "reader", state: "knows", since: certain.at, how: "原文明写", basis: "explicit", history: readerRecords });
    else if (readerRecords.length) { const last = readerRecords.at(-1)!; rows.push({ who: "reader", state: last.state, since: last.at, how: last.how, basis: last.basis, history: readerRecords }); }
    else if (inferable) rows.push({ who: "reader", state: "can-infer", since: inferable.at, how: inferable.reason, basis: "inferred", history: [] });
    else rows.push({ who: "reader", state: "none", since: null, basis: "explicit", history: [] });

    const people = new Set<string>(extra);
    for (const item of dataset.knowledge) if (item.who !== "reader" && targets.has(item.about) && visible(item.at, readAt)) people.add(item.who);
    for (const who of people) {
        const history = recordsFor(dataset, who, targets, readAt);
        // 明写的记录优先于程序派生的记录；同为明写时取最新的一条。
        const explicit = history.filter(item => !item.derived);
        const last = (explicit.length ? explicit : history).at(-1);
        if (!last) { rows.push({ who, state: "none", since: null, basis: "explicit", history }); continue; }
        // “知道”从最近一次“不知道”之后第一次得知算起；“仍不知道”给出最近一次表现出不知道的位置。
        let start = 0;
        history.forEach((item, index) => { if (item.state === "unaware") start = index + 1; });
        const first = last.state === "unaware" ? last : history.slice(start).find(item => item.state === last.state) ?? last;
        rows.push({ who, state: last.state, since: first.at, how: last.how, basis: last.basis, history });
    }
    return rows;
}

export interface TrackState {
    owner: string; track: string; entries: LedgerEntry[];
    /** 数量类的当前数值。 */
    value?: number;
    /** 文字类的当前状态，例如“已完成”。 */
    state?: string;
    /** 持有的东西及数量。 */
    holdings: { item: string; count: number }[];
}

/** 某个阅读位置上各个量的当前值和来龙去脉。 */
export function ledgerState(dataset: Dataset, readAt: Position): TrackState[] {
    const tracks = new Map<string, TrackState>();
    for (const item of [...dataset.ledger].sort((a, b) => comparePosition(a.at, b.at))) {
        if (!visible(item.at, readAt)) continue;
        const key = `${item.owner}\u0000${item.track}`;
        const track = tracks.get(key) ?? { owner: item.owner, track: item.track, entries: [], holdings: [] };
        tracks.set(key, track);
        track.entries.push(item);
        if (item.running !== undefined) track.value = item.running;
        else if (item.op === "set" && item.value !== undefined) track.state = String(item.value);
        if (item.item && (item.op === "get" || item.op === "lose" || item.op === "use")) {
            const held = track.holdings.find(entry => entry.item === item.item) ?? { item: item.item, count: 0 };
            if (!track.holdings.includes(held)) track.holdings.push(held);
            held.count = Math.max(0, held.count + (item.op === "get" ? 1 : -1) * (item.amount ?? 1));
        }
    }
    return [...tracks.values()];
}

export type QuestionState = "open" | "partial" | "answered";

export function questionStatus(question: Question, readAt: Position): { state: QuestionState; updates: Question["updates"] } {
    const updates = question.updates.filter(item => visible(item.at, readAt));
    const state: QuestionState = updates.some(item => item.type === "answered") ? "answered" : updates.some(item => item.type === "partial") ? "partial" : "open";
    return { state, updates };
}

/** 一个情节在某个阅读位置已经可见的连接。 */
export const visibleLinks = (episode: Episode, readAt: Position): Episode["links"] => episode.links.filter(link => visible(link.at, readAt));

export interface TimelineRow { time: TimeAnchor; episodes: Episode[]; flashbackBeats: string[] }

/** 按故事里的先后（不是原文先后）排出时间点和发生在其上的情节。 */
export function timeline(dataset: Dataset, readAt: Position): TimelineRow[] {
    return dataset.times.filter(item => visible(item.at, readAt)).sort((a, b) => a.order - b.order).map(time => ({
        time,
        episodes: dataset.episodes.filter(item => item.time === time.id && visible(item.at, readAt)),
        flashbackBeats: dataset.beats.filter(item => item.time === time.id && item.flashback && visible(item.at, readAt)).map(item => item.id),
    }));
}

export interface Profile {
    entity: Entity; name: string;
    names: Entity["names"];
    /** 每章被提到多少次。 */
    mentionChapters: { chapter: number; count: number }[];
    /** 以在场或参与的身份出现在哪些章。 */
    appearChapters: number[];
    about: Statement[];
    held: Statement[];
    episodes: Episode[];
    knowledge: Knowledge[];
    summaries: Summary[];
    sameAs: string[];
}

/** 一个对象在某个阅读位置能查到的全部内容。 */
export function profile(dataset: Dataset, id: string, readAt: Position): Profile | null {
    const entity = dataset.entities.find(item => item.id === id);
    if (!entity || !visible(entity.at, readAt)) return null;
    const mentions = dataset.mentions.filter(item => item.entity === id && visible(item.at, readAt));
    const chapters = new Map<number, number>();
    for (const mention of mentions) chapters.set(mention.at.chapter, (chapters.get(mention.at.chapter) ?? 0) + 1);
    const episodes = dataset.episodes.filter(item => visible(item.at, readAt) && item.who.some(who => who.e === id || who.as === id));
    const latest = new Map<string, Summary>();
    for (const summary of dataset.summaries) if (summary.entity === id && visible(summary.at, readAt)) latest.set(summary.facet, summary);
    return {
        entity, name: displayName(entity, readAt),
        names: entity.names.filter(name => visible(name.at, readAt)),
        mentionChapters: [...chapters].map(([chapter, count]) => ({ chapter, count })).sort((a, b) => a.chapter - b.chapter),
        appearChapters: [...new Set(episodes.map(item => item.at.chapter))].sort((a, b) => a - b),
        about: dataset.statements.filter(item => visible(item.at, readAt) && item.about.includes(id)),
        held: dataset.statements.filter(item => visible(item.at, readAt) && item.holder === id),
        episodes,
        knowledge: dataset.knowledge.filter(item => item.who === id && visible(item.at, readAt)),
        summaries: [...latest.values()],
        sameAs: identityGroups(dataset, readAt).find(group => group.members.includes(id))?.members.filter(member => member !== id) ?? [],
    };
}

/** 某段原文里出现的称呼，供查看器在原文上标出对象。 */
export function mentionsIn(dataset: Dataset, at: Position): Mention[] {
    return dataset.mentions.filter(item => comparePosition(item.at, at) === 0);
}
