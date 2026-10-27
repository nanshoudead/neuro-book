/**
 * 记录等级：模型抽取时给的先验加程序在阅读位置 P 算的后验证据，按规则表合并成 1 到 3 级（docs/specs/story/queries.md
 * 的“记录等级”）。只对说法算后验；情节的等级就是先验；对象不分级。
 *
 * 分两层算，因为后验要在每个阅读位置重算（用 P 之后的信息就是剧透），而扫原文很贵：
 * - 底稿（与 P 无关）：每条说法的词组、每个词组出现在哪些章、每个词组从哪里起算作称呼、每条说法的后文引用。
 *   第一次用到时按索引建一份，随索引回收；
 * - 某个 P 的结果：在底稿上按 P 截取后计数、查表，每个索引留最近几个 P。
 *
 * 不剧透靠两件事：底稿里每个量都带着自己的位置，按 P 截取时只用 ≤ P 的；P 所在章只算 P 以前的段。所以把数据截到
 * P 再算，结果与全量数据在 P 算的相同（tiers.test.ts 的截断对照）。等级不依赖视角：视角是读者的筛选，不是防剧透的边界。
 */

import type {BookIndex} from "./book-index";
import type {Family, Position, Statement} from "./dataset";
import {comparePosition, visibleAt} from "./position";

export type Tier = 1 | 2 | 3;
/** 后验证据：未知（读过的后文还不够）、没有、有一点、强。 */
export type Evidence = "unknown" | "none" | "some" | "strong";
/** 只在有先验时出现：先验 1 级而后文没有证据（待证实），先验 3 级而后文有强证据（伏笔候选）。 */
export type TierFlag = "unconfirmed" | "foreshadow";

/** 后文对这条说法的引用，按来源分开计数；只数引用方在说法所在章之后、且在 P 以前成立的。 */
export interface RefCounts {
    /** 别的说法确认、反驳、修订它（`rel`）。 */
    confirms: number;
    contradicts: number;
    revises: number;
    /** 后来得知它的人数（草稿写的知情，不含程序推出的）。 */
    knowers: number;
    /** 后文建立、收录它的秘密数。 */
    secrets: number;
    /** 后文以它为解答的悬念进展数。 */
    answers: number;
}

export interface StatementTier {
    tier: Tier;
    prior: Tier | null;
    ev: Evidence;
    flag: TierFlag | null;
    refs: RefCounts;
    /** 事件词组的后文回响：个数与命中的词组（最多 ECHO_SHOWN 个，给依据用）。 */
    echo: {count: number; grams: string[]};
    /** 证据窗口：说法所在章之后读到了几章（P 所在章算一章）。 */
    window: number;
}

/** 证据窗口少于这么多章、证据又不强时，后验记为“未知”。 */
export const EVIDENCE_WINDOW = 5;
/** 词组出现的章数上限：可见章数的这个比例，至少 ECHO_MIN_CAP 章；更常见的词组不算回响。 */
const ECHO_CAP_RATIO = 0.4;
const ECHO_MIN_CAP = 5;
/** 强证据要的回响词组数。 */
const ECHO_STRONG = 5;
const ECHO_SHOWN = 5;
const GRAM = 4;
/** 每个索引留几个阅读位置的结果。 */
const TABLES_PER_INDEX = 8;

const COLUMNS: readonly Evidence[] = ["unknown", "none", "some", "strong"];

/** 表一：有先验时，行是先验，列是后验（顺序同 COLUMNS）。 */
const WITH_PRIOR: Record<Tier, readonly Tier[]> = {
    1: [1, 2, 1, 1],
    2: [2, 2, 2, 1],
    3: [3, 3, 3, 2],
};

type FamilyGroup = "major" | "middle" | "minor";
const FAMILY_GROUP: Record<Family, FamilyGroup> = {
    identity: "major",
    rule: "major",
    goal: "major",
    kinship: "major",
    event: "middle",
    social: "middle",
    membership: "middle",
    possession: "middle",
    trait: "middle",
    other: "middle",
    attitude: "minor",
    location: "minor",
};
/** 表二：没有先验时，行是类别组，列是后验。“未知”一律 2 级，刚读到的章不被成批折叠。 */
const WITHOUT_PRIOR: Record<FamilyGroup, readonly Tier[]> = {
    major: [2, 2, 1, 1],
    middle: [2, 3, 2, 1],
    minor: [2, 3, 3, 2],
};

/** 按规则表合并；`prior` 为 null 时按类别查表二。 */
export function combineTier(prior: Tier | null, family: Family, ev: Evidence): {tier: Tier; flag: TierFlag | null} {
    const column = COLUMNS.indexOf(ev);
    if (prior === null) return {tier: WITHOUT_PRIOR[FAMILY_GROUP[family]][column]!, flag: null};
    const tier = WITH_PRIOR[prior][column]!;
    const flag = prior === 1 && tier === 2 ? "unconfirmed" : prior === 3 && tier === 2 ? "foreshadow" : null;
    return {tier, flag};
}

/** 数据里写的先验；不是 1 到 3 的整数时当作没有。 */
export function priorTier(record: {tier?: number}): Tier | null {
    const value = record.tier;
    return value === 1 || value === 2 || value === 3 ? value : null;
}

/** 情节的等级就是先验，没有先验为 null。 */
export const episodeTier = priorTier;

// ---- 底稿 ----

type RefType = keyof RefCounts;

interface StatementBase {
    chapter: number;
    prior: Tier | null;
    family: Family;
    grams: readonly string[];
    /** 后文引用：引用方所在章大于说法所在章的；`who` 只给知情，用来按人去重。 */
    refs: readonly {type: RefType; at: Position; who?: string}[];
}

/** 一个词组在原文里出现的章（升序）与在那一章里第一次出现的段，以及它从哪里起算作称呼。 */
interface GramBase {
    chapters: number[];
    firstParagraph: number[];
    nameAt: Position | null;
}

interface TierBase {
    statements: Map<string, StatementBase>;
    grams: Map<string, GramBase>;
}

/** 文字里的 4 字词组：按标点与空白切成片段，片段内逐字取，不跨句；去重。 */
function gramsOf(text: string): string[] {
    const result = new Set<string>();
    for (const piece of text.split(/[^\p{L}\p{N}]+/u)) {
        const chars = Array.from(piece);
        for (let index = 0; index + GRAM <= chars.length; index += 1) result.add(chars.slice(index, index + GRAM).join(""));
    }
    return [...result];
}

function earlier(a: Position | null, b: Position): Position {
    return a === null || comparePosition(b, a) < 0 ? b : a;
}

/** 词组从哪里起算作称呼：与它互相包含的称呼里最早出现的位置。 */
function nameAtOf(gram: string, exact: ReadonlyMap<string, Position>, inside: ReadonlyMap<string, Position>): Position | null {
    let result: Position | null = inside.get(gram) ?? null;
    const chars = Array.from(gram);
    for (let length = 1; length <= chars.length; length += 1) {
        for (let start = 0; start + length <= chars.length; start += 1) {
            const at = exact.get(chars.slice(start, start + length).join(""));
            if (at !== undefined) result = earlier(result, at);
        }
    }
    return result;
}

function buildBase(index: BookIndex): TierBase {
    const statements = new Map<string, StatementBase>();
    const wanted = new Set<string>();
    for (const statement of index.statements) {
        const grams = gramsOf(statement.text);
        for (const gram of grams) wanted.add(gram);
        statements.set(statement.id, {chapter: statement.at.chapter, prior: priorTier(statement), family: statement.family, grams, refs: []});
    }
    const addRef = (id: string, type: RefType, at: Position, who?: string) => {
        const target = statements.get(id);
        if (target && at.chapter > target.chapter) (target.refs as StatementBase["refs"][number][]).push(who === undefined ? {type, at} : {type, at, who});
    };
    const REL_REF: Record<Statement["rel"][number]["type"], RefType> = {confirms: "confirms", contradicts: "contradicts", revises: "revises"};
    for (const statement of index.statements) for (const rel of statement.rel) addRef(rel.to, REL_REF[rel.type], statement.at);
    for (const item of index.knowledge) if (!item.derived) addRef(item.about, "knowers", item.at, item.who);
    for (const secret of index.secrets) {
        const members = new Set(secret.statements);
        for (const statement of index.statements) if (statement.secret === secret.id) members.add(statement.id);
        for (const id of members) addRef(id, "secrets", secret.at);
    }
    for (const question of index.questions) for (const update of question.updates) if (update.answer !== undefined) addRef(update.answer, "answers", update.at);

    // 称呼：完整的称呼（词组包含它）与称呼里的 4 字片段（它包含词组），各记最早出现的位置。
    const exact = new Map<string, Position>();
    const inside = new Map<string, Position>();
    for (const entity of index.entities) {
        for (const name of entity.names) {
            if (name.text === "") continue;
            exact.set(name.text, earlier(exact.get(name.text) ?? null, name.at));
            for (const gram of gramsOf(name.text)) inside.set(gram, earlier(inside.get(gram) ?? null, name.at));
        }
    }
    // 词组出现在哪些章：原文之外也看记录的文字（说法、情节的标题、概要与步骤）。记录是抽取时的转述，与说法同一种
    // 用词；文白差别大的书（例如西游记）原文里几乎找不到说法的词组，只看原文时回响会系统性偏低。
    const seen = new Map<string, Map<number, number>>();
    const note = (text: string, at: Position) => {
        for (const gram of gramsOf(text)) {
            if (!wanted.has(gram)) continue;
            let byChapter = seen.get(gram);
            if (!byChapter) seen.set(gram, (byChapter = new Map()));
            const first = byChapter.get(at.chapter);
            if (first === undefined || at.paragraph < first) byChapter.set(at.chapter, at.paragraph);
        }
    };
    for (const chapter of index.chapters.values()) chapter.paragraphs.forEach((paragraph, offset) => note(paragraph, {chapter: chapter.chapter, paragraph: offset + 1}));
    for (const statement of index.statements) note(statement.text, statement.at);
    for (const episode of index.episodes) note([episode.title, episode.summary, ...episode.steps.map(step => step.text)].join("。"), episode.at);
    const grams = new Map<string, GramBase>();
    for (const gram of wanted) {
        const byChapter = [...(seen.get(gram) ?? [])].sort((x, y) => x[0] - y[0]);
        grams.set(gram, {chapters: byChapter.map(([chapter]) => chapter), firstParagraph: byChapter.map(([, paragraph]) => paragraph), nameAt: nameAtOf(gram, exact, inside)});
    }
    return {statements, grams};
}

const bases = new WeakMap<BookIndex, TierBase>();

function baseOf(index: BookIndex): TierBase {
    let base = bases.get(index);
    if (!base) {
        base = buildBase(index);
        bases.set(index, base);
    }
    return base;
}

// ---- 某个阅读位置的结果 ----

/** 已排序数组里小于 value 的个数。 */
function countBelow(sorted: readonly number[], value: number): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (sorted[middle]! < value) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** 词组在 P 以前出现过的章（P 所在章只算 P 以前的段），返回这些章在 `chapters` 里的个数。 */
function seenChapters(info: GramBase, at: Position): number {
    const before = countBelow(info.chapters, at.chapter);
    return info.chapters[before] === at.chapter && info.firstParagraph[before]! <= at.paragraph ? before + 1 : before;
}

function statementTier(base: StatementBase, grams: ReadonlyMap<string, GramBase>, at: Position): StatementTier {
    const refs: RefCounts = {confirms: 0, contradicts: 0, revises: 0, knowers: 0, secrets: 0, answers: 0};
    const knowers = new Set<string>();
    for (const ref of base.refs) {
        if (!visibleAt(ref.at, at)) continue;
        if (ref.who !== undefined) knowers.add(ref.who);
        else refs[ref.type] += 1;
    }
    refs.knowers = knowers.size;
    const cap = Math.max(ECHO_MIN_CAP, Math.ceil(ECHO_CAP_RATIO * at.chapter));
    const echoed: string[] = [];
    for (const gram of base.grams) {
        const info = grams.get(gram)!;
        if (info.nameAt !== null && visibleAt(info.nameAt, at)) continue;
        const seen = seenChapters(info, at);
        // 后文出现过：在说法所在章之后、P 以前的章里有它。
        if (seen >= 2 && seen <= cap && info.chapters[seen - 1]! > base.chapter) echoed.push(gram);
    }
    const window = at.chapter - base.chapter;
    const strong = Object.values(refs).some(count => count > 0) || echoed.length >= ECHO_STRONG;
    const ev: Evidence = strong ? "strong" : window < EVIDENCE_WINDOW ? "unknown" : echoed.length > 0 ? "some" : "none";
    return {...combineTier(base.prior, base.family, ev), prior: base.prior, ev, refs, echo: {count: echoed.length, grams: echoed.slice(0, ECHO_SHOWN)}, window};
}

export interface TierTable {
    /** P 时可见的说法的等级；不可见或不存在的为 undefined。 */
    statement(id: string): StatementTier | undefined;
}

const tables = new WeakMap<BookIndex, Map<string, TierTable>>();

/** 阅读位置 `at` 的等级表。同一索引最近用过的几个位置有缓存；表里的每条说法第一次取时才算。 */
export function tiersAt(index: BookIndex, at: Position): TierTable {
    let perIndex = tables.get(index);
    if (!perIndex) {
        perIndex = new Map();
        tables.set(index, perIndex);
    }
    const key = `${at.chapter}.${at.paragraph}`;
    const cached = perIndex.get(key);
    if (cached) {
        perIndex.delete(key);
        perIndex.set(key, cached);
        return cached;
    }
    const base = baseOf(index);
    const computed = new Map<string, StatementTier>();
    const table: TierTable = {
        statement(id) {
            const found = computed.get(id);
            if (found) return found;
            const record = index.statementById.get(id);
            const statementBase = base.statements.get(id);
            if (!record || !statementBase || !visibleAt(record.at, at)) return undefined;
            const result = statementTier(statementBase, base.grams, at);
            computed.set(id, result);
            return result;
        },
    };
    perIndex.set(key, table);
    while (perIndex.size > TABLES_PER_INDEX) perIndex.delete(perIndex.keys().next().value!);
    return table;
}
