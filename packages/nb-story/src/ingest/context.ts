/**
 * “已有记录”：抽下一章之前，由截至上一章已提交的记忆图生成、放进模型请求的一段文字（docs/specs/story/ingest.md 输出 4）。
 *
 * 搬自 w00005 t27 `context.ts` 与它用到的 `query.ts` 函数，文字逐字不变：抽取的质量是用这份文字验证的，改一个标点
 * 都要重新验证。所以这里不改用 `core/projection.ts` 的视图（那边按查询接口的合同算，出处写成“章.段—章.段”，
 * 这里写“章.段-段”），两边重叠的几个函数各管各的。
 */

import type {Dataset, Entity, Knowledge, KnowledgeState, LedgerEntry, Position, Question, Secret, Span, TimeAnchor} from "../core/dataset";
import {comparePosition, formatPosition, visibleAt} from "../core/position";

const KIND_ZH: Record<string, string> = {person: "人物", persona: "身份", group: "组织", place: "地点", item: "物品", concept: "概念", task: "任务", other: "其他"};
const PART_ZH: Record<string, string> = {dawn: "凌晨", morning: "早晨", forenoon: "上午", noon: "中午", afternoon: "下午", dusk: "傍晚", evening: "晚上", night: "深夜"};
const STATE_ZH: Record<string, string> = {knows: "知道", believes: "相信", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道", "can-infer": "可推断", none: "没有记录"};

const formatSpan = (span: Span): string => (span.from === span.to ? `${span.chapter}.${span.from}` : `${span.chapter}.${span.from}-${span.to}`);

/** 生成“写下一章草稿之前要看的已有记录”：截至第 `afterChapter` 章末。 */
export function renderContext(dataset: Dataset, afterChapter: number): string {
    const last = dataset.sources.find(item => item.chapter === afterChapter);
    const readAt: Position = {chapter: afterChapter, paragraph: last?.paragraphs.length ?? 1};
    const unique = uniqueNames(dataset, readAt);
    const name = (id: string) => {
        if (id === "reader") return "读者";
        const entity = dataset.entities.find(item => item.id === id);
        return entity ? unique.get(entity.id) ?? displayName(entity, readAt) : id;
    };
    const lines: string[] = [`# 截至第 ${afterChapter} 章的已有记录`, ""];

    lines.push("## 对象名册", "", "编号｜类别｜当前称呼｜整理标签｜书里出现过的称呼");
    for (const entity of dataset.entities) {
        if (!visibleAt(entity.at, readAt)) continue;
        const names = entity.names.filter(item => visibleAt(item.at, readAt)).map(item => (item.note ? `${item.text}（${item.note}）` : item.text));
        lines.push(`${entity.id}｜${KIND_ZH[entity.kind]}｜${displayName(entity, readAt)}｜${entity.label}｜${names.join("、") || "无"}${entity.note ? `｜${entity.note}` : ""}`);
    }

    const secrets = dataset.secrets.filter(item => visibleAt(item.at, readAt));
    if (secrets.length) {
        lines.push("", "## 秘密与知情", "", "每章都要留意：有没有人得知、起疑，或者表现出仍不知道。标了“推断”的知情判断，本章出现新依据（支持或反驳）时，补一条引用本章原文的知情记录。");
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

    const open = dataset.questions.filter(item => visibleAt(item.at, readAt)).map(item => ({item, state: questionState(item, readAt)})).filter(entry => entry.state !== "answered");
    if (open.length) {
        lines.push("", "## 未解的疑问", "");
        for (const {item, state} of open) lines.push(`${item.id}　${item.text}（${formatPosition(item.at)} 提出${state === "partial" ? "，已有部分解答" : ""}）`);
    }

    const tracks = ledgerState(dataset, readAt);
    if (tracks.length) {
        lines.push("", "## 当前状态", "", "同一个量要沿用下面的名字。");
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

    const times = dataset.times.filter(item => visibleAt(item.at, readAt));
    if (times.length) {
        lines.push("", "## 时间点", "");
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
    const statements = dataset.statements.filter(item => visibleAt(item.at, readAt)).slice(-400);
    if (statements.length) {
        lines.push("", "## 已有的说法", "", "后文印证、反驳或修正这些说法时，用编号指向它们。");
        for (const item of statements) lines.push(`${item.id}　${item.text}`);
    }
    return `${lines.join("\n")}\n`;
}

/** 对象在某个阅读位置的显示名：取此时最新的主要称呼；还没有称呼时用整理标签并加括号标明。 */
export function displayName(entity: Entity, readAt: Position): string {
    const names = entity.names.filter(name => visibleAt(name.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
    const primary = names.filter(name => name.primary).at(-1);
    return primary?.text ?? names[0]?.text ?? `〔${entity.label}〕`;
}

/** 此时可见的两个对象显示名相同时，各自带上整理标签，列表里才分得清。 */
function uniqueNames(dataset: Dataset, readAt: Position): Map<string, string> {
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
