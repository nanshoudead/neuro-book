/**
 * “已有记录”：抽下一章之前，由截至上一章已提交的记忆图生成、放进模型请求的一段文字（docs/specs/story/ingest.md 输出 4）。
 *
 * 搬自 w00005 t27 `context.ts` 与它用到的 `query.ts` 函数。不传 `focus` 时文字与 t34 当时发出的逐字相同（原来整理用它，
 * w00024 t12 起整理改用 `consolidation-context.ts`；全量的写法留作回放时换回对照），`context.test.ts` 对照；每一行的写法也沿用它。抽取的质量是用这份文字验证的，改写法要另做质量对照。所以这里不改用
 * `core/projection.ts` 的视图（那边按查询接口的合同算，出处写成“章.段—章.段”，这里写“章.段-段”），两边重叠的几个
 * 函数各管各的。
 *
 * 传 `focus` 时（抽普通章）只详列与这一章相关的行，让请求的大小不随全书增长（w00024 t10，各节怎么选见 `selectFor`）。
 * 选法的依据是旧管线的引用实测，质量由 t10 的回归验证。
 */

import type {Dataset, Entity, Knowledge, KnowledgeState, LedgerEntry, Position, Question, Secret, Span, Statement, TimeAnchor} from "../core/dataset";
import {featuresOf} from "../core/dataset";
import {displayName} from "../core/display-name";
import {comparePosition, formatPosition, visibleAt} from "../core/position";
import {occurrenceFinder} from "./text-match";

export const KIND_ZH: Record<string, string> = {person: "人物", persona: "身份", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其他"};
const PART_ZH: Record<string, string> = {dawn: "凌晨", morning: "早晨", forenoon: "上午", noon: "中午", afternoon: "下午", dusk: "傍晚", evening: "晚上", night: "深夜"};
export const STATE_ZH: Record<string, string> = {knows: "知道", believes: "相信", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道", "can-infer": "可推断", none: "没有记录"};

const formatSpan = (span: Span): string => (span.from === span.to ? `${span.chapter}.${span.from}` : `${span.chapter}.${span.from}-${span.to}`);

/** 这次要抽的章：`text` 是它的原文，用来找相关对象；`statements` 给了就照它列说法（挑选的结果），没给按规则缩减。 */
export interface ContextFocus {
    text: string;
    statements?: readonly string[];
}

/** 最近几章有提及的对象也算相关：本章原文里没写出称呼、只用代称的，多半是刚出场过的。 */
const RECENT_CHAPTERS = 3;
/** 疑问只列最近这么多章里提出或有进展的：旧管线的引用 97% 在这个范围里（t10 README）。 */
const QUESTION_WINDOW = 20;
/** 时间点只列最后这么多个：旧管线几乎只引用最新的一两个。 */
const TIME_LIMIT = 20;
/** 按规则缩减时说法一节的字数上限。 */
export const STATEMENT_BUDGET = 8000;

/** 生成“写下一章草稿之前要看的已有记录”：截至第 `afterChapter` 章末。 */
export function renderContext(dataset: Dataset, afterChapter: number, focus?: ContextFocus): string {
    const last = dataset.sources.find(item => item.chapter === afterChapter);
    const readAt: Position = {chapter: afterChapter, paragraph: last?.paragraphs.length ?? 1};
    const selected = focus ? selectFor(dataset, afterChapter, readAt, focus) : null;
    const unique = uniqueNames(dataset, readAt);
    const name = (id: string) => {
        if (id === "reader") return "读者";
        const entity = dataset.entities.find(item => item.id === id);
        return entity ? unique.get(entity.id) ?? displayName(entity, readAt) : id;
    };
    // 关掉的那类（docs/specs/story/ingest.md 输出 18）书里本来就没有记录，这里再明写一次不列，免得这条依赖藏在数据里。
    const features = featuresOf(dataset.book.features);
    const lines: string[] = [`# 截至第 ${afterChapter} 章的已有记录`, ""];

    lines.push("## 对象名册", "");
    if (selected) lines.push("只详列本章原文里出现了称呼、或最近 3 章出现过的对象；其余的在下面“其他对象”里。");
    lines.push("编号｜类别｜当前称呼｜整理标签｜书里出现过的称呼");
    const others: Entity[] = [];
    for (const entity of dataset.entities) {
        if (!visibleAt(entity.at, readAt)) continue;
        if (selected && !selected.entities.has(entity.id)) {
            others.push(entity);
            continue;
        }
        const names = entity.names.filter(item => visibleAt(item.at, readAt)).map(item => (item.note ? `${item.text}（${item.note}）` : item.text));
        lines.push(`${entity.id}｜${KIND_ZH[entity.kind]}｜${displayName(entity, readAt)}｜${entity.label}｜${names.join("、") || "无"}${entity.note ? `｜${entity.note}` : ""}`);
    }

    if (others.length) {
        lines.push("", "## 其他对象", "", "本章原文里没有出现、最近 3 章也没有出现的对象。本章遇到它们时沿用编号，不要另建。", "编号｜类别｜当前称呼｜整理标签");
        for (const entity of others) lines.push(`${entity.id}｜${KIND_ZH[entity.kind]}｜${displayName(entity, readAt)}｜${entity.label}`);
    }

    const secrets = features.secrets ? dataset.secrets.filter(item => visibleAt(item.at, readAt) && (!selected || selected.secrets.has(item.id))) : [];
    if (secrets.length) {
        lines.push("", "## 秘密与知情", "", "每章都要留意：有没有人得知、起疑，或者表现出仍不知道。标了“推断”的知情判断，本章出现新依据（支持或反驳）时，补一条引用本章原文的知情记录。");
        if (selected) lines.push("只列与本章相关对象有关的秘密。");
        for (const secret of secrets) {
            lines.push("", `${secret.id}　${secret.title}（相关说法：${secret.statements.join("、") || "无"}）`);
            for (const row of secretTable(dataset, secret, readAt)) {
                // 推断出来的知情判断连同依据一起列出，下一章才知道该补什么新依据。
                const latest = row.history.at(-1);
                const basis = row.basis === "inferred" ? `，推断${latest?.evidence.length ? `，依据 ${latest.evidence.map(item => formatSpan(item)).join("、")}` : ""}` : "";
                lines.push(`- ${name(row.who)}：${STATE_ZH[row.state]}${row.since ? `（${row.state === "unaware" ? "最近一次表现在" : "自"} ${formatPosition(row.since)}）` : ""}${row.how ? `，${row.how}` : ""}${basis}`);
            }
        }
    }

    const open = dataset.questions.filter(item => visibleAt(item.at, readAt) && (!selected || selected.questions.has(item.id))).map(item => ({item, state: questionState(item, readAt)})).filter(entry => entry.state !== "answered");
    if (open.length) {
        lines.push("", "## 未解的疑问", "");
        if (selected) lines.push(`只列最近 ${QUESTION_WINDOW} 章里提出或有进展的。本章解答或再提起更早的疑问时，新建一条疑问，在疑问的文字里写清它接的是哪件事。`, "");
        for (const {item, state} of open) lines.push(`${item.id}　${item.text}（${formatPosition(item.at)} 提出${state === "partial" ? "，已有部分解答" : ""}）`);
    }

    const tracks = features.ledger ? ledgerState(dataset, readAt).filter(track => !selected || selected.entities.has(track.owner)) : [];
    if (tracks.length) {
        lines.push("", "## 当前状态", "", "同一个量要沿用下面的名字。");
        if (selected) lines.push("只列本章相关对象的量；别的对象的量出现变化时，量的名字照原文写。");
        for (const track of tracks) {
            const parts: string[] = [];
            // 数量是程序逐笔累加出来的，原文里不一定出现过这个数，所以注明。
            if (track.value !== undefined) parts.push(`${track.value}（程序累加）`);
            if (track.state !== undefined) parts.push(track.state);
            const held = track.holdings.filter(entry => entry.count > 0).map(entry => `${name(entry.item)}${entry.count > 1 ? `×${entry.count}` : ""}`);
            if (track.holdings.length) parts.push(held.length ? `持有 ${held.join("、")}` : "目前没有持有");
            lines.push(`- ${name(track.owner)}（${track.owner}）的“${track.track}”：${parts.join("；")}（最近变动 ${formatPosition(track.entries.at(-1)!.at)}）`);
        }
    }

    const times = dataset.times.filter(item => visibleAt(item.at, readAt) && (!selected || selected.times.has(item.id)));
    if (times.length) {
        lines.push("", "## 时间点", "");
        if (selected) lines.push(`只列最近的 ${TIME_LIMIT} 个。`, "");
        for (const time of [...times].sort((a, b) => a.order - b.order)) {
            const {clock, date} = timeFacts(time, readAt);
            lines.push(`${time.id}　${time.day !== undefined ? `第 ${time.day} 天` : "主线之前"}${time.part ? ` ${PART_ZH[time.part]}` : ""}${clock ? ` ${clock}` : ""}${date ? `（${date}）` : ""}　${time.label}`);
        }
    }

    const episodes = dataset.episodes.filter(item => visibleAt(item.at, readAt)).slice(-12);
    if (episodes.length) {
        lines.push("", "## 最近的情节", "", "新情节要连到前面相关的情节。");
        for (const episode of episodes) lines.push(`${episode.id}　${episode.title}（${formatPosition(episode.at)}）`);
    }

    // 不针对具体对象的说法（世界设定、作者声明）也要列出，后面的章节才能引用它们。
    const visibleStatements = dataset.statements.filter(item => visibleAt(item.at, readAt));
    const statements = selected ? visibleStatements.filter(item => selected.statements.has(item.id)) : visibleStatements.slice(-400);
    if (statements.length) {
        lines.push("", "## 已有的说法", "", "后文印证、反驳或修正这些说法时，用编号指向它们。");
        if (selected) lines.push(focus?.statements ? "只列挑出来的与本章可能相关的说法。" : `只列一部分：挂在上面${features.secrets ? "秘密与" : ""}疑问上的、不针对具体对象的，以及最近的说法。`);
        for (const item of statements) lines.push(`${item.id}　${item.text}`);
    }
    return `${lines.join("\n")}\n`;
}

interface Selection {
    /** 详列的对象；其余的进“其他对象”。“当前状态”也只列它们的量。 */
    entities: Set<string>;
    secrets: Set<string>;
    questions: Set<string>;
    times: Set<string>;
    statements: Set<string>;
}

/** 与这一章相关的对象，与跟着它们、跟着时间窗口列出的秘密和疑问。普通章的已有记录与挑选说法的候选共用。 */
interface Relevance {
    entities: Set<string>;
    secrets: Secret[];
    questions: Question[];
}

/**
 * 相关对象是本章原文里出现了称呼的（同一称呼属于几个对象时都算），加上最近几章有提及的；秘密跟着相关对象走，疑问
 * 按时间窗口（ingest.md 输出 4）。
 */
function relevanceFor(dataset: Dataset, afterChapter: number, readAt: Position, text: string): Relevance {
    const names = dataset.entities
        .filter(entity => visibleAt(entity.at, readAt))
        .flatMap(entity => entity.names.filter(name => visibleAt(name.at, readAt) && [...name.text].length >= 2).map(name => ({entity: entity.id, text: name.text})));
    const found = occurrenceFinder(names.map(name => name.text))(text);
    // 最近的提及只要求对象此时可见，不要求它有可见的称呼：只用代称出现过的对象也算（实现审查第 7 条）。
    const visibleIds = new Set(dataset.entities.filter(entity => visibleAt(entity.at, readAt)).map(entity => entity.id));
    const entities = new Set(names.filter(name => found.has(name.text)).map(name => name.entity));
    for (const mention of dataset.mentions) {
        if (mention.at.chapter > afterChapter - RECENT_CHAPTERS && visibleAt(mention.at, readAt) && visibleIds.has(mention.entity)) entities.add(mention.entity);
    }

    const knowers = new Map<string, Set<string>>();
    for (const item of dataset.knowledge) {
        if (!visibleAt(item.at, readAt)) continue;
        const who = knowers.get(item.about) ?? new Set<string>();
        who.add(item.who);
        knowers.set(item.about, who);
    }
    // 知情记录可以指向秘密本身，也可以指向它列的说法（与 secretTable 的目标相同）。
    const knowsAbout = (secret: Secret) => [secret.id, ...secret.statements].some(target => [...(knowers.get(target) ?? [])].some(id => entities.has(id)));
    const secrets = dataset.secrets.filter(secret => visibleAt(secret.at, readAt) && (secret.about.some(id => entities.has(id)) || knowsAbout(secret)));

    const since = afterChapter - QUESTION_WINDOW;
    // 只要会列出的：已解答的不列，它的答案也不算“列出的疑问的答案”（实现审查第 4 条）。
    const questions = dataset.questions.filter(question => visibleAt(question.at, readAt) && questionState(question, readAt) !== "answered" && (question.at.chapter > since || question.updates.some(update => visibleAt(update.at, readAt) && update.at.chapter > since)));
    return {entities, secrets, questions};
}

/** 挂在列出的秘密、疑问上的说法编号：秘密列的说法、说法自己标的秘密不在这里（见 `linkedTo`），疑问的答案。 */
function linkedIds(relevance: Relevance, readAt: Position): Set<string> {
    return new Set([
        ...relevance.secrets.flatMap(secret => secret.statements),
        ...relevance.questions.flatMap(question => question.updates.filter(update => visibleAt(update.at, readAt)).map(update => update.answer).filter((id): id is string => id !== undefined)),
    ]);
}

/** 说法挂在列出的秘密、疑问上。 */
function linkedTo(relevance: Relevance, linked: Set<string>): (item: Statement) => boolean {
    const secrets = new Set(relevance.secrets.map(secret => secret.id));
    return item => linked.has(item.id) || (item.secret !== undefined && secrets.has(item.secret));
}

/** 不针对任何对象、秘密的说法（世界设定、作者声明）：没有别的途径会被选中，所以排在最前（样例书全书 3 条）。 */
const unattached = (item: Statement) => item.about.length === 0 && item.source.by === null && item.holder === null && item.secret === undefined;

/** 按顺序从几组里取说法，合计不超过 `budget` 字（按已有记录里的一行算）；每组取到放不下为止。 */
function takeWithin(groups: Statement[][], budget: number): Statement[] {
    const taken: Statement[] = [];
    let used = 0;
    for (const group of groups) {
        for (const item of group) {
            const size = `${item.id}　${item.text}\n`.length;
            if (used + size > budget) break;
            used += size;
            taken.push(item);
        }
    }
    return taken;
}

function selectFor(dataset: Dataset, afterChapter: number, readAt: Position, focus: ContextFocus): Selection {
    const relevance = relevanceFor(dataset, afterChapter, readAt, focus.text);
    const times = new Set(dataset.times.filter(time => visibleAt(time.at, readAt)).sort((a, b) => a.order - b.order).slice(-TIME_LIMIT).map(time => time.id));
    let statements: Set<string>;
    if (focus.statements) statements = new Set(focus.statements);
    else {
        // 先放不针对具体对象的与挂在列出的秘密、疑问上的，再用最近的补满。旧管线的跨章说法引用在 8,000 字时全部
        // 留住，只取最近的会丢一些（t10 README 决定 9）。
        const linked = linkedTo(relevance, linkedIds(relevance, readAt));
        const newestFirst = dataset.statements.filter(item => visibleAt(item.at, readAt)).sort((a, b) => comparePosition(b.at, a.at));
        statements = new Set(takeWithin([newestFirst.filter(unattached), newestFirst.filter(item => !unattached(item) && linked(item)), newestFirst.filter(item => !unattached(item) && !linked(item))], STATEMENT_BUDGET).map(item => item.id));
    }
    return {entities: relevance.entities, secrets: new Set(relevance.secrets.map(secret => secret.id)), questions: new Set(relevance.questions.map(question => question.id)), times, statements};
}

/** 挑选说法的候选合计的字数上限：挑选那一步的请求大小由它定。 */
export const RECALL_CANDIDATE_BUDGET = 25_000;

/**
 * 挑选相关说法的候选（ingest.md 输出 4）：不针对具体对象的先放，再放挂在列出的秘密、疑问上的，再放涉及相关对象
 * （`about`、说话人、持有人）的，各自从新到旧，合计到上限为止。按原文先后返回。
 */
export function recallCandidates(dataset: Dataset, afterChapter: number, text: string): {id: string; text: string}[] {
    const last = dataset.sources.find(item => item.chapter === afterChapter);
    const readAt: Position = {chapter: afterChapter, paragraph: last?.paragraphs.length ?? 1};
    const relevance = relevanceFor(dataset, afterChapter, readAt, text);
    const linked = linkedTo(relevance, linkedIds(relevance, readAt));
    const involved = (item: Statement) => item.about.some(id => relevance.entities.has(id)) || (item.source.by !== null && relevance.entities.has(item.source.by)) || (item.holder !== null && relevance.entities.has(item.holder));
    const newestFirst = dataset.statements.filter(item => visibleAt(item.at, readAt)).sort((a, b) => comparePosition(b.at, a.at));
    const rest = newestFirst.filter(item => !unattached(item));
    const taken = new Set(takeWithin([newestFirst.filter(unattached), rest.filter(linked), rest.filter(item => !linked(item) && involved(item))], RECALL_CANDIDATE_BUDGET));
    return dataset.statements.filter(item => taken.has(item)).map(item => ({id: item.id, text: item.text}));
}

/** 对象在某个阅读位置的显示名（实现在 core，修订也用它）。 */
export {displayName};

/** 此时可见的两个对象显示名相同时，各自带上整理标签，列表里才分得清。 */
export function uniqueNames(dataset: Dataset, readAt: Position): Map<string, string> {
    const shown = dataset.entities.filter(item => visibleAt(item.at, readAt)).map(item => [item, displayName(item, readAt)] as const);
    const counts = new Map<string, number>();
    for (const [, name] of shown) counts.set(name, (counts.get(name) ?? 0) + 1);
    return new Map(shown.map(([item, name]) => [item.id, counts.get(name)! > 1 ? `${name}（${item.label}）` : name]));
}

/** 时间点的钟点和日期在某个阅读位置能不能显示：它们可能比时间点本身交代得晚。 */
function timeFacts(time: TimeAnchor, readAt: Position): {clock?: string; date?: string} {
    return {
        clock: time.clock !== undefined && visibleAt(time.clockAt ?? time.at, readAt) ? time.clock : undefined,
        date: time.date !== undefined && visibleAt(time.dateAt ?? time.at, readAt) ? time.date : undefined,
    };
}

/** 某人对某个秘密或某条说法的知情记录，按原文先后排列。 */
function recordsFor(dataset: Dataset, who: string, targets: Set<string>, readAt: Position): Knowledge[] {
    return dataset.knowledge.filter(item => item.who === who && targets.has(item.about) && visibleAt(item.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
}

interface SecretRow {
    who: string;
    /** 此时的知情状态；none 表示没有任何记录，不等于不知道。 */
    state: KnowledgeState | "can-infer" | "none";
    since: Position | null;
    how?: string;
    basis: "explicit" | "inferred";
    history: Knowledge[];
}

/** 某个秘密在某个阅读位置的知情表：读者一行，每个有记录的角色一行。 */
function secretTable(dataset: Dataset, secret: Secret, readAt: Position): SecretRow[] {
    const targets = new Set([secret.id, ...secret.statements]);
    const rows: SecretRow[] = [];
    const facts = secret.statements.map(id => dataset.statements.find(item => item.id === id)!).filter(item => item && visibleAt(item.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
    const readerRecords = recordsFor(dataset, "reader", targets, readAt);
    const certain = facts.find(item => item.kind === "fact" && item.certainty === "certain" && item.basis === "explicit");
    const inferable = facts.find(item => item.kind === "fact");
    if (certain) rows.push({who: "reader", state: "knows", since: certain.at, how: "原文明写", basis: "explicit", history: readerRecords});
    else if (readerRecords.length) {
        const latest = readerRecords.at(-1)!;
        rows.push({who: "reader", state: latest.state, since: latest.at, how: latest.how, basis: latest.basis, history: readerRecords});
    } else if (inferable) rows.push({who: "reader", state: "can-infer", since: inferable.at, how: inferable.reason, basis: "inferred", history: []});
    else rows.push({who: "reader", state: "none", since: null, basis: "explicit", history: []});

    const people = new Set<string>();
    for (const item of dataset.knowledge) if (item.who !== "reader" && targets.has(item.about) && visibleAt(item.at, readAt)) people.add(item.who);
    for (const who of people) {
        const history = recordsFor(dataset, who, targets, readAt);
        // 明写的记录优先于程序派生的记录；同为明写时取最新的一条。
        const explicit = history.filter(item => !item.derived);
        const latest = (explicit.length ? explicit : history).at(-1);
        if (!latest) {
            rows.push({who, state: "none", since: null, basis: "explicit", history});
            continue;
        }
        // “知道”从最近一次“不知道”之后第一次得知算起；“仍不知道”给出最近一次表现出不知道的位置。
        let start = 0;
        history.forEach((item, index) => {
            if (item.state === "unaware") start = index + 1;
        });
        const first = latest.state === "unaware" ? latest : history.slice(start).find(item => item.state === latest.state) ?? latest;
        rows.push({who, state: latest.state, since: first.at, how: latest.how, basis: latest.basis, history});
    }
    return rows;
}

interface TrackState {
    owner: string;
    track: string;
    entries: LedgerEntry[];
    /** 数量类的当前数值。 */
    value?: number;
    /** 文字类的当前状态，例如“已完成”。 */
    state?: string;
    /** 持有的东西及数量。 */
    holdings: {item: string; count: number}[];
}

/** 某个阅读位置上各个量的当前值和来龙去脉。 */
function ledgerState(dataset: Dataset, readAt: Position): TrackState[] {
    const tracks = new Map<string, TrackState>();
    for (const item of [...dataset.ledger].sort((a, b) => comparePosition(a.at, b.at))) {
        if (!visibleAt(item.at, readAt)) continue;
        const key = `${item.owner}\u0000${item.track}`;
        const track = tracks.get(key) ?? {owner: item.owner, track: item.track, entries: [], holdings: []};
        tracks.set(key, track);
        track.entries.push(item);
        if (item.running !== undefined) track.value = item.running;
        else if (item.op === "set" && item.value !== undefined) track.state = String(item.value);
        if (item.item && (item.op === "get" || item.op === "lose" || item.op === "use")) {
            const held = track.holdings.find(entry => entry.item === item.item) ?? {item: item.item, count: 0};
            if (!track.holdings.includes(held)) track.holdings.push(held);
            held.count = Math.max(0, held.count + (item.op === "get" ? 1 : -1) * (item.amount ?? 1));
        }
    }
    return [...tracks.values()];
}

function questionState(question: Question, readAt: Position): "open" | "partial" | "answered" {
    const updates = question.updates.filter(item => visibleAt(item.at, readAt));
    return updates.some(item => item.type === "answered") ? "answered" : updates.some(item => item.type === "partial") ? "partial" : "open";
}
