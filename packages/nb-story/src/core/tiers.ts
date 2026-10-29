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
    /**
     * 事件词组的后文回响：`count` 是回响的 4 字词组数（判定证据用）；`phrases` 是给人看的词句：说法里相邻或重叠的
     * 回响词组连成一句，按在说法里的先后，最多 ECHO_SHOWN 句。
     */
    echo: {count: number; phrases: string[]};
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

/** 说法里的一个 4 字词组：在说法文字里的起点（按字），以及它与说法里哪个称呼重叠、那个称呼最早出现的位置。 */
interface StatementGram {
    gram: string;
    start: number;
    nameAt: Position | null;
}

interface StatementBase {
    chapter: number;
    prior: Tier | null;
    family: Family;
    /** 说法文字逐字拆开（连回响词句用）。 */
    chars: readonly string[];
    grams: readonly StatementGram[];
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
    /** 说法里某个词组的出现情况；只接受说法里的词组。 */
    gram(gram: string): GramBase;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
/** 基本平面字符是否算字的缓存：0 未判断，1 是，2 否。底表要扫全书原文，逐字跑正则占了建表的大半时间。 */
const bmpWordChar = new Uint8Array(0x10000);

function isWordChar(code: number): boolean {
    if (code > 0xffff) return WORD_CHAR.test(String.fromCodePoint(code));
    if (bmpWordChar[code] === 0) bmpWordChar[code] = WORD_CHAR.test(String.fromCharCode(code)) ? 1 : 2;
    return bmpWordChar[code] === 1;
}

/**
 * 逐字扫出 4 字词组：标点与空白处断开，不跨句。visit 收到词组与它的起点（按字计，与 Array.from 的下标一致）。
 * 词组直接从原串按 UTF-16 偏移切出，不先拆成字的数组。
 */
function scanGrams(text: string, visit: (gram: string, start: number) => void): void {
    // 最近 GRAM 个字各自的 UTF-16 起点，环形存放。
    const offsets = new Array<number>(GRAM).fill(0);
    let run = 0;
    let char = 0;
    for (let offset = 0; offset < text.length; char += 1) {
        const code = text.codePointAt(offset)!;
        const next = offset + (code > 0xffff ? 2 : 1);
        offsets[char % GRAM] = offset;
        run = isWordChar(code) ? run + 1 : 0;
        if (run >= GRAM) visit(text.slice(offsets[(char + 1) % GRAM]!, next), char - GRAM + 1);
        offset = next;
    }
}

/** 文字里的 4 字词组，去重。 */
function gramsOf(text: string): string[] {
    const result = new Set<string>();
    scanGrams(text, gram => result.add(gram));
    return [...result];
}

function earlier(a: Position | null, b: Position): Position {
    return a === null || comparePosition(b, a) < 0 ? b : a;
}

/** 词组从哪里起算作称呼：与它互相包含的称呼里最早出现的位置。 */
function nameAtOf(gram: string, exact: ReadonlyMap<string, Position>, inside: ReadonlyMap<string, Position>): Position | null {
    let result: Position | null = inside.get(gram) ?? null;
    // 全是基本平面字符时（几乎总是）直接按下标切子串，免得每个词组都拆成数组再拼回。
    const chars = gram.length === GRAM ? null : Array.from(gram);
    const count = chars?.length ?? GRAM;
    for (let length = 1; length <= count; length += 1) {
        for (let start = 0; start + length <= count; start += 1) {
            const at = exact.get(chars ? chars.slice(start, start + length).join("") : gram.slice(start, start + length));
            if (at !== undefined) result = earlier(result, at);
        }
    }
    return result;
}

/**
 * 说法里每个字被哪个称呼盖住、那个称呼最早出现的位置（没被盖住为 null）。盖住的字所在的词组不算回响：
 * “晴在视频”这类带半截人名的词组只说明人物又出场了，不说明这件事被再提起。
 */
function nameCover(chars: readonly string[], namesByFirst: ReadonlyMap<string, readonly {chars: readonly string[]; at: Position}[]>): (Position | null)[] {
    const cover: (Position | null)[] = chars.map(() => null);
    for (let start = 0; start < chars.length; start += 1) {
        for (const name of namesByFirst.get(chars[start]!) ?? []) {
            if (start + name.chars.length > chars.length || name.chars.some((char, offset) => chars[start + offset] !== char)) continue;
            for (let offset = 0; offset < name.chars.length; offset += 1) cover[start + offset] = earlier(cover[start + offset]!, name.at);
        }
    }
    return cover;
}

function buildBase(index: BookIndex): TierBase {
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
    const namesByFirst = new Map<string, {chars: string[]; at: Position}[]>();
    for (const [text, at] of exact) {
        const chars = Array.from(text);
        const list = namesByFirst.get(chars[0]!);
        if (list) list.push({chars, at});
        else namesByFirst.set(chars[0]!, [{chars, at}]);
    }

    const statements = new Map<string, StatementBase>();
    const wanted = new Set<string>();
    for (const statement of index.statements) {
        const chars = Array.from(statement.text);
        const cover = nameCover(chars, namesByFirst);
        const grams: StatementGram[] = [];
        const seenGram = new Set<string>();
        scanGrams(statement.text, (gram, start) => {
            if (seenGram.has(gram)) return;
            seenGram.add(gram);
            wanted.add(gram);
            let nameAt: Position | null = null;
            for (let offset = 0; offset < GRAM; offset += 1) {
                const at = cover[start + offset];
                if (at) nameAt = earlier(nameAt, at);
            }
            grams.push({gram, start, nameAt});
        });
        statements.set(statement.id, {chapter: statement.at.chapter, prior: priorTier(statement), family: statement.family, chars, grams, refs: []});
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

    // 词组出现在哪些章：原文之外也看记录的文字（说法、情节的标题、概要与步骤）。记录是抽取时的转述，与说法同一种
    // 用词；文白差别大的书（例如西游记）原文里几乎找不到说法的词组，只看原文时回响会系统性偏低。
    // 按章的先后记，每个词组的章就是升序追加的，不用再排序；同一章里留最早的段。
    const seen = new Map<string, {chapters: number[]; firstParagraph: number[]; nameAt?: Position | null}>();
    for (const text of wanted) seen.set(text, {chapters: [], firstParagraph: []});
    const note = (text: string, at: Position) => {
        scanGrams(text, gram => {
            const info = seen.get(gram);
            if (!info) return;
            const last = info.chapters.length - 1;
            if (last >= 0 && info.chapters[last] === at.chapter) {
                if (at.paragraph < info.firstParagraph[last]!) info.firstParagraph[last] = at.paragraph;
            } else {
                info.chapters.push(at.chapter);
                info.firstParagraph.push(at.paragraph);
            }
        });
    };
    const records = new Map<number, {text: string; at: Position}[]>();
    const addRecord = (text: string, at: Position) => {
        const list = records.get(at.chapter);
        if (list) list.push({text, at});
        else records.set(at.chapter, [{text, at}]);
    };
    for (const statement of index.statements) addRecord(statement.text, statement.at);
    for (const episode of index.episodes) addRecord([episode.title, episode.summary, ...episode.steps.map(step => step.text)].join("。"), episode.at);
    for (const chapter of [...new Set([...index.chapters.keys(), ...records.keys()])].sort((a, b) => a - b)) {
        index.chapters.get(chapter)?.paragraphs.forEach((paragraph, offset) => note(paragraph, {chapter, paragraph: offset + 1}));
        for (const record of records.get(chapter) ?? []) note(record.text, record.at);
    }
    // 称呼位置在第一次用到时才算：一次查询只碰到被问到的说法的词组。
    const gram = (text: string): GramBase => {
        const info = seen.get(text)!;
        if (info.nameAt === undefined) info.nameAt = nameAtOf(text, exact, inside);
        return info as GramBase;
    };
    return {statements, gram};
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

function statementTier(base: StatementBase, gramOf: (gram: string) => GramBase, at: Position): StatementTier {
    const refs: RefCounts = {confirms: 0, contradicts: 0, revises: 0, knowers: 0, secrets: 0, answers: 0};
    const knowers = new Set<string>();
    for (const ref of base.refs) {
        if (!visibleAt(ref.at, at)) continue;
        if (ref.who !== undefined) knowers.add(ref.who);
        else refs[ref.type] += 1;
    }
    refs.knowers = knowers.size;
    const cap = Math.max(ECHO_MIN_CAP, Math.ceil(ECHO_CAP_RATIO * at.chapter));
    const echoed: StatementGram[] = [];
    for (const item of base.grams) {
        const info = gramOf(item.gram);
        if ((info.nameAt !== null && visibleAt(info.nameAt, at)) || (item.nameAt !== null && visibleAt(item.nameAt, at))) continue;
        const seen = seenChapters(info, at);
        // 后文出现过：在说法所在章之后、P 以前的章里有它。
        if (seen >= 2 && seen <= cap && info.chapters[seen - 1]! > base.chapter) echoed.push(item);
    }
    const window = at.chapter - base.chapter;
    const strong = Object.values(refs).some(count => count > 0) || echoed.length >= ECHO_STRONG;
    const ev: Evidence = strong ? "strong" : window < EVIDENCE_WINDOW ? "unknown" : echoed.length > 0 ? "some" : "none";
    return {...combineTier(base.prior, base.family, ev), prior: base.prior, ev, refs, echo: {count: echoed.length, phrases: phrasesOf(base.chars, echoed).slice(0, ECHO_SHOWN)}, window};
}

/** 回响词组按起点连成词句：重叠或紧挨着的连在一起。`grams` 已按起点升序。 */
function phrasesOf(chars: readonly string[], grams: readonly StatementGram[]): string[] {
    const phrases: string[] = [];
    let from = -1;
    let to = -1;
    for (const {start} of grams) {
        if (start <= to) {
            to = Math.max(to, start + GRAM);
            continue;
        }
        if (from >= 0) phrases.push(chars.slice(from, to).join(""));
        from = start;
        to = start + GRAM;
    }
    if (from >= 0) phrases.push(chars.slice(from, to).join(""));
    return phrases;
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
            const result = statementTier(statementBase, base.gram, at);
            computed.set(id, result);
            return result;
        },
    };
    perIndex.set(key, table);
    while (perIndex.size > TABLES_PER_INDEX) perIndex.delete(perIndex.keys().next().value!);
    return table;
}
