/**
 * V9 小说记忆图的数据集类型（`schema` 为 `neurobook.memory.v9`）。
 *
 * 结构由 w00005 的抽取管线产出，语义见 docs/proposals/novel-memory-v9.md；这里搬的是 w00005 t27 `schema.ts` 里
 * “编译后的数据集”那一段，抽取用的草稿结构不搬。nb-story 只读这份数据，不修改记录。
 *
 * 导入时只校验到“各类记录是数组、每条有 id 与位置”（见 validateDataset）：数据由同一条管线产出，逐字段严格校验
 * 只会拖慢导入；管线换了数据版本时，`schema` 字段会变，导入按版本拒绝。
 */

export const DATASET_SCHEMA = "neurobook.memory.v9";

export const ENTITY_KINDS = ["person", "persona", "group", "place", "item", "concept", "task", "other"] as const;
export const FAMILIES = ["identity", "kinship", "social", "membership", "possession", "location", "trait", "rule", "goal", "attitude", "event", "other"] as const;
export const CHANNELS = ["narrator", "speech", "thought", "document", "author"] as const;
export const MODES = ["assert", "question", "guess", "promise", "plan", "deny", "condition"] as const;
export const STATEMENT_KINDS = ["fact", "belief", "claim"] as const;
export const KNOWLEDGE_STATES = ["knows", "believes", "suspects", "heard", "read", "unaware"] as const;
export const DAY_PARTS = ["dawn", "morning", "forenoon", "noon", "afternoon", "dusk", "evening", "night"] as const;
export const EPISODE_LINKS = ["after", "continues", "retells", "causes", "motivates", "enables"] as const;
export const LEDGER_OPS = ["set", "gain", "spend", "get", "lose", "use"] as const;
export const FACETS = ["overview", "appearance", "personality", "relations", "history", "abilities", "goals"] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];
export type Family = (typeof FAMILIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Facet = (typeof FACETS)[number];
export type Basis = "explicit" | "inferred";

/** 原文位置。段号从 1 起，第 1 段是章名。 */
export interface Position {
    chapter: number;
    paragraph: number;
}
/** 同一章里的一段范围。 */
export interface Span {
    chapter: number;
    from: number;
    to: number;
}

export interface SourceChapter {
    chapter: number;
    title: string;
    paragraphs: string[];
    sha256: string;
}

export interface EntityName {
    text: string;
    at: Position;
    primary: boolean;
    note?: string;
}
export interface Entity {
    id: string;
    kind: EntityKind;
    label: string;
    note?: string;
    at: Position;
    names: EntityName[];
    /** 整理时被并入的对象编号。 */
    mergedFrom: string[];
}
/** 程序在原文里找到的一次称呼。via=note 表示由草稿指定了归属。 */
export interface Mention {
    entity: string;
    text: string;
    at: Position;
    start: number;
    end: number;
    via: "match" | "note";
}
export interface TimeAnchor {
    id: string;
    label: string;
    day?: number;
    part?: (typeof DAY_PARTS)[number];
    clock?: string;
    date?: string;
    /** 钟点、日期各自从哪里起可见；没有写就和时间点本身一起可见。 */
    clockAt?: Position;
    dateAt?: Position;
    rel: {type: "after" | "before" | "same"; to: string; gap?: string; days?: number}[];
    evidence: Span[];
    basis: Basis;
    note?: string;
    at: Position;
    /** 程序排出的故事先后次序，越小越早。 */
    order: number;
}
export interface Beat {
    id: string;
    chapter: number;
    from: number;
    to: number;
    gist: string;
    time: string | null;
    flashback: boolean;
    at: Position;
}
export interface Statement {
    id: string;
    text: string;
    family: Family;
    label?: string;
    about: string[];
    source: {evidence: Span[]; channel: Channel; by: string | null; to: string[]; mode: (typeof MODES)[number]};
    kind: StatementKind;
    /** 信念或说法的持有人；世界事实为 null。 */
    holder: string | null;
    basis: Basis;
    premises: string[];
    reason?: string;
    certainty: "certain" | "candidate";
    neg: boolean;
    time: string | null;
    secret?: string;
    rel: {type: "confirms" | "contradicts" | "revises"; to: string; note?: string}[];
    unverified?: string;
    at: Position;
}
export interface Secret {
    id: string;
    title: string;
    about: string[];
    note?: string;
    statements: string[];
    at: Position;
}
export interface Episode {
    id: string;
    title: string;
    summary: string;
    evidence: Span[];
    time: string;
    place?: string;
    who: {e: string; as?: string; role?: string}[];
    steps: {text: string; evidence: Span}[];
    outcome?: string;
    /** 每条连接有自己的可见位置：情节自带的连接随情节可见，后面章节补的连接从补的那一章结束起可见。 */
    links: {type: (typeof EPISODE_LINKS)[number]; to: string; note?: string; at: Position}[];
    at: Position;
}
export interface Knowledge {
    id: string;
    who: string;
    /** 一条说法或一个秘密的 id。 */
    about: string;
    state: KnowledgeState;
    how?: string;
    evidence: Span[];
    basis: Basis;
    unverified?: string;
    at: Position;
    /** 程序从说法的来源推出的知情，不是草稿写的。 */
    derived: boolean;
}
export interface LedgerEntry {
    id: string;
    owner: string;
    track: string;
    op: (typeof LEDGER_OPS)[number];
    amount?: number;
    value?: number | string;
    item?: string;
    reason: string;
    evidence: Span[];
    basis: Basis;
    unverified?: string;
    at: Position;
    /** 程序算出的变动后数值；只有数量类才有。 */
    running?: number;
    /** 原文给出的数值和累加结果是否一致；没有给出数值时为 null。 */
    check: "match" | "mismatch" | null;
}
export interface QuestionUpdate {
    type: "raised" | "partial" | "answered";
    evidence: Span[];
    answer?: string;
    note?: string;
    reliability?: "narrator" | "claim" | "belief" | "inferred";
    at: Position;
}
export interface Question {
    id: string;
    text: string;
    evidence: Span[];
    about: string[];
    by?: string;
    at: Position;
    updates: QuestionUpdate[];
}
export interface Summary {
    entity: string;
    facet: Facet;
    /** 归纳到第几章。 */
    through: number;
    items: {text: string; deps: string[]}[];
    at: Position;
}
export interface Arc {
    id: string;
    title: string;
    summary: string;
    episodes: string[];
    status: "ongoing" | "closed";
    /** 这一批归纳到第几章；同一批的主线 through 相同。 */
    through: number;
    at: Position;
}

export interface Dataset {
    schema: typeof DATASET_SCHEMA;
    book: {id: string; title: string};
    through: Position;
    sources: SourceChapter[];
    entities: Entity[];
    mentions: Mention[];
    times: TimeAnchor[];
    beats: Beat[];
    statements: Statement[];
    secrets: Secret[];
    episodes: Episode[];
    knowledge: Knowledge[];
    ledger: LedgerEntry[];
    questions: Question[];
    summaries: Summary[];
    arcs: Arc[];
    /** 各类记录里，草稿写了多少条、程序生成了多少条；覆盖全书，不随阅读位置变。 */
    stats: {written: Record<string, number>; generated: Record<string, number>; chars: number};
}

/** 带 `id` 与 `at` 的记录数组；`summaries` 没有 id、`mentions` 没有 id，单独检查。 */
const RECORD_ARRAYS = ["entities", "times", "beats", "statements", "secrets", "episodes", "knowledge", "ledger", "questions", "arcs"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): boolean {
    return isObject(value) && Number.isInteger(value.chapter) && Number.isInteger(value.paragraph);
}

/**
 * 校验导入文件是不是 V9 数据集，返回第一处问题的说明；没有问题返回 null。
 * 只查结构骨架（理由见模块头），类型断言由这里的检查支撑。
 */
export function validateDataset(value: unknown): string | null {
    if (!isObject(value)) return "不是 JSON 对象";
    if (value.schema !== DATASET_SCHEMA) return `schema 不是 ${DATASET_SCHEMA}`;
    if (!isObject(value.book) || typeof value.book.title !== "string") return "缺少 book.title";
    if (!isPosition(value.through)) return "缺少 through";
    if (!Array.isArray(value.sources) || value.sources.length === 0) return "缺少原文 sources";
    for (const chapter of value.sources) {
        if (!isObject(chapter) || !Number.isInteger(chapter.chapter) || typeof chapter.title !== "string" || !Array.isArray(chapter.paragraphs)) return "sources 里有不合法的章";
    }
    for (const key of RECORD_ARRAYS) {
        const records = value[key];
        if (!Array.isArray(records)) return `缺少 ${key}`;
        for (const record of records) {
            if (!isObject(record) || typeof record.id !== "string" || !isPosition(record.at)) return `${key} 里有缺少 id 或 at 的记录`;
        }
    }
    for (const key of ["mentions", "summaries"] as const) {
        const records = value[key];
        if (!Array.isArray(records)) return `缺少 ${key}`;
        for (const record of records) {
            if (!isObject(record) || !isPosition(record.at)) return `${key} 里有缺少 at 的记录`;
        }
    }
    if (!isObject(value.stats)) return "缺少 stats";
    return null;
}
