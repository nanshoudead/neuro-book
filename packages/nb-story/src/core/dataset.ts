/**
 * V9 小说记忆图的数据集（`schema` 为 `neurobook.memory.v9`）：TypeBox schema 与由它推出的类型。
 *
 * 结构由 w00005 的抽取管线产出，语义见 docs/proposals/novel-memory-v9.md；字段照搬 w00005 t27 `schema.ts` 里
 * “编译后的数据集”那一段，抽取用的草稿结构不搬。nb-story 只读这份数据，不修改记录。
 *
 * 导入时整份按这里的 schema 校验（validateDataset），查询代码才能直接解引用字段。几类记录形状不同：
 * 原文 `sources` 没有 id 与 at，`mentions`、`summaries` 没有 id。对象类 schema 允许多出的字段：
 * 管线加了新字段时旧程序照常导入，只是不用它。
 */

import {Type} from "typebox";
import type {Static, TLiteral, TSchema, TUnion} from "typebox";
import {Compile} from "typebox/compile";

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

/** 字符串字面量的联合。map 出来的数组丢了逐项的字面量类型，断言由 map 一一对应保证。 */
function oneOf<const T extends readonly string[]>(values: T): TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}> {
    return Type.Union(values.map(value => Type.Literal(value))) as unknown as TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}>;
}

const Text = Type.String();
const Id = Type.String({minLength: 1});
const Int = Type.Integer();
const Basis = oneOf(["explicit", "inferred"] as const);
const Tier = Type.Integer({minimum: 1, maximum: 3});

/** 原文位置。段号从 1 起，第 1 段是章名。 */
const PositionSchema = Type.Object({chapter: Int, paragraph: Int});
/** 同一章里的一段范围。 */
const SpanSchema = Type.Object({chapter: Int, from: Int, to: Int});

const SourceChapterSchema = Type.Object({chapter: Int, title: Text, paragraphs: Type.Array(Text), sha256: Text});

const EntityNameSchema = Type.Object({text: Text, at: PositionSchema, primary: Type.Boolean(), note: Type.Optional(Text)});
const EntitySchema = Type.Object({
    id: Id,
    kind: oneOf(ENTITY_KINDS),
    label: Text,
    note: Type.Optional(Text),
    at: PositionSchema,
    names: Type.Array(EntityNameSchema),
    /** 整理时被并入的对象编号。 */
    mergedFrom: Type.Array(Id),
});

/** 程序在原文里找到的一次称呼。via=note 表示由草稿指定了归属。 */
const MentionSchema = Type.Object({entity: Id, text: Text, at: PositionSchema, start: Int, end: Int, via: oneOf(["match", "note"] as const)});

const TimeAnchorSchema = Type.Object({
    id: Id,
    label: Text,
    day: Type.Optional(Type.Number()),
    part: Type.Optional(oneOf(DAY_PARTS)),
    clock: Type.Optional(Text),
    date: Type.Optional(Text),
    /** 钟点、日期各自从哪里起可见；没有写就和时间点本身一起可见。 */
    clockAt: Type.Optional(PositionSchema),
    dateAt: Type.Optional(PositionSchema),
    rel: Type.Array(Type.Object({type: oneOf(["after", "before", "same"] as const), to: Id, gap: Type.Optional(Text), days: Type.Optional(Type.Number())})),
    evidence: Type.Array(SpanSchema),
    basis: Basis,
    note: Type.Optional(Text),
    at: PositionSchema,
    /** 程序排出的故事先后次序，越小越早。 */
    order: Type.Number(),
});

const BeatSchema = Type.Object({
    id: Id,
    chapter: Int,
    from: Int,
    to: Int,
    gist: Text,
    time: Type.Union([Id, Type.Null()]),
    flashback: Type.Boolean(),
    at: PositionSchema,
});

const StatementSchema = Type.Object({
    id: Id,
    text: Text,
    family: oneOf(FAMILIES),
    label: Type.Optional(Text),
    about: Type.Array(Id),
    source: Type.Object({
        evidence: Type.Array(SpanSchema),
        channel: oneOf(CHANNELS),
        by: Type.Union([Id, Type.Null()]),
        to: Type.Array(Id),
        mode: oneOf(MODES),
    }),
    kind: oneOf(STATEMENT_KINDS),
    /** 信念或说法的持有人；世界事实为 null。 */
    holder: Type.Union([Id, Type.Null()]),
    basis: Basis,
    premises: Type.Array(Id),
    reason: Type.Optional(Text),
    certainty: oneOf(["certain", "candidate"] as const),
    neg: Type.Boolean(),
    time: Type.Union([Id, Type.Null()]),
    secret: Type.Optional(Id),
    rel: Type.Array(Type.Object({type: oneOf(["confirms", "contradicts", "revises"] as const), to: Id, note: Type.Optional(Text)})),
    unverified: Type.Optional(Text),
    /** 先验等级：模型抽取当时给的重要程度，1 主线必需、2 有用、3 琐碎；旧书与没写的为缺省（docs/specs/story/queries.md 的记录等级）。 */
    tier: Type.Optional(Tier),
    at: PositionSchema,
});

const SecretSchema = Type.Object({id: Id, title: Text, about: Type.Array(Id), note: Type.Optional(Text), statements: Type.Array(Id), at: PositionSchema});

const EpisodeSchema = Type.Object({
    id: Id,
    title: Text,
    summary: Text,
    evidence: Type.Array(SpanSchema),
    time: Text,
    place: Type.Optional(Text),
    who: Type.Array(Type.Object({e: Id, as: Type.Optional(Text), role: Type.Optional(Text)})),
    steps: Type.Array(Type.Object({text: Text, evidence: SpanSchema})),
    outcome: Type.Optional(Text),
    /** 先验等级，同说法的 `tier`。 */
    tier: Type.Optional(Tier),
    /** 每条连接有自己的可见位置：情节自带的连接随情节可见，后面章节补的连接从补的那一章结束起可见。 */
    links: Type.Array(Type.Object({type: oneOf(EPISODE_LINKS), to: Id, note: Type.Optional(Text), at: PositionSchema})),
    at: PositionSchema,
});

const KnowledgeSchema = Type.Object({
    id: Id,
    who: Id,
    /** 一条说法或一个秘密的 id。 */
    about: Id,
    state: oneOf(KNOWLEDGE_STATES),
    how: Type.Optional(Text),
    evidence: Type.Array(SpanSchema),
    basis: Basis,
    unverified: Type.Optional(Text),
    at: PositionSchema,
    /** 程序从说法的来源推出的知情，不是草稿写的。 */
    derived: Type.Boolean(),
});

const LedgerEntrySchema = Type.Object({
    id: Id,
    owner: Id,
    track: Text,
    op: oneOf(LEDGER_OPS),
    amount: Type.Optional(Type.Number()),
    value: Type.Optional(Type.Union([Type.Number(), Text])),
    item: Type.Optional(Text),
    reason: Text,
    evidence: Type.Array(SpanSchema),
    basis: Basis,
    unverified: Type.Optional(Text),
    at: PositionSchema,
    /** 程序算出的变动后数值；只有数量类才有。 */
    running: Type.Optional(Type.Number()),
    /** 原文给出的数值和累加结果是否一致；没有给出数值时为 null。 */
    check: Type.Union([oneOf(["match", "mismatch"] as const), Type.Null()]),
});

const QuestionUpdateSchema = Type.Object({
    type: oneOf(["raised", "partial", "answered"] as const),
    evidence: Type.Array(SpanSchema),
    answer: Type.Optional(Text),
    note: Type.Optional(Text),
    reliability: Type.Optional(oneOf(["narrator", "claim", "belief", "inferred"] as const)),
    at: PositionSchema,
});
const QuestionSchema = Type.Object({
    id: Id,
    text: Text,
    evidence: Type.Array(SpanSchema),
    about: Type.Array(Id),
    by: Type.Optional(Id),
    at: PositionSchema,
    updates: Type.Array(QuestionUpdateSchema),
});

const SummarySchema = Type.Object({
    entity: Id,
    facet: oneOf(FACETS),
    /** 归纳到第几章。 */
    through: Int,
    items: Type.Array(Type.Object({text: Text, deps: Type.Array(Id)})),
    at: PositionSchema,
});

const ArcSchema = Type.Object({
    id: Id,
    title: Text,
    summary: Text,
    episodes: Type.Array(Id),
    status: oneOf(["ongoing", "closed"] as const),
    /** 这一批归纳到第几章；同一批的主线 through 相同。 */
    through: Int,
    at: PositionSchema,
});

/**
 * 这本书记不记数值（`ledger`）与秘密（`secrets`）（docs/specs/story/ingest.md 的按书开关）。没有这一项、或缺了某一项
 * 的书按开着算：开关之前的书与导入的数据文件都是全记的。
 */
export const BookFeaturesSchema = Type.Object({ledger: Type.Boolean(), secrets: Type.Boolean()});

export const DatasetSchema = Type.Object({
    schema: Type.Literal(DATASET_SCHEMA),
    book: Type.Object({id: Text, title: Text, features: Type.Optional(Type.Partial(BookFeaturesSchema))}),
    through: PositionSchema,
    sources: Type.Array(SourceChapterSchema, {minItems: 1}),
    entities: Type.Array(EntitySchema),
    mentions: Type.Array(MentionSchema),
    times: Type.Array(TimeAnchorSchema),
    beats: Type.Array(BeatSchema),
    statements: Type.Array(StatementSchema),
    secrets: Type.Array(SecretSchema),
    episodes: Type.Array(EpisodeSchema),
    knowledge: Type.Array(KnowledgeSchema),
    ledger: Type.Array(LedgerEntrySchema),
    questions: Type.Array(QuestionSchema),
    summaries: Type.Array(SummarySchema),
    arcs: Type.Array(ArcSchema),
    /** 各类记录里，草稿写了多少条、程序生成了多少条；覆盖全书，不随阅读位置变。 */
    stats: Type.Object({written: Type.Record(Type.String(), Type.Number()), generated: Type.Record(Type.String(), Type.Number()), chars: Type.Number()}),
});

export type EntityKind = (typeof ENTITY_KINDS)[number];
export type Family = (typeof FAMILIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Facet = (typeof FACETS)[number];
export type Basis = Static<typeof Basis>;

export type Position = Static<typeof PositionSchema>;
export type Span = Static<typeof SpanSchema>;
export type SourceChapter = Static<typeof SourceChapterSchema>;
export type EntityName = Static<typeof EntityNameSchema>;
export type Entity = Static<typeof EntitySchema>;
export type Mention = Static<typeof MentionSchema>;
export type TimeAnchor = Static<typeof TimeAnchorSchema>;
export type Beat = Static<typeof BeatSchema>;
export type Statement = Static<typeof StatementSchema>;
export type Secret = Static<typeof SecretSchema>;
export type Episode = Static<typeof EpisodeSchema>;
export type Knowledge = Static<typeof KnowledgeSchema>;
export type LedgerEntry = Static<typeof LedgerEntrySchema>;
export type QuestionUpdate = Static<typeof QuestionUpdateSchema>;
export type Question = Static<typeof QuestionSchema>;
export type Summary = Static<typeof SummarySchema>;
export type Arc = Static<typeof ArcSchema>;
export type Dataset = Static<typeof DatasetSchema>;
export type BookFeatures = Static<typeof BookFeaturesSchema>;

/** 补上缺省值（开）的开关。 */
export function featuresOf(features?: Partial<BookFeatures>): BookFeatures {
    return {ledger: features?.ledger ?? true, secrets: features?.secrets ?? true};
}

/**
 * 数据集与开关冲突的那一项：关掉了某类，却带着这类记录。导入时据此拒绝（docs/specs/story/queries.md 的 `book.import`），
 * 书里就一定没有关掉的那类记录，查询不用逐个判断开关。
 */
export function featureConflict(dataset: Dataset): string | null {
    const features = featuresOf(dataset.book.features);
    if (!features.ledger && dataset.ledger.length) return `book.features.ledger 是 false，却有 ${dataset.ledger.length} 条数值记录`;
    if (!features.secrets && dataset.secrets.length) return `book.features.secrets 是 false，却有 ${dataset.secrets.length} 个秘密`;
    return null;
}

let compiled: ReturnType<typeof Compile<TSchema>> | undefined;

/** 校验导入文件是不是 V9 数据集，返回前几处问题的说明；没有问题返回 null。 */
export function validateDataset(value: unknown): string | null {
    compiled ??= Compile(DatasetSchema as TSchema);
    if (compiled.Check(value)) return null;
    return [...compiled.Errors(value)]
        .slice(0, 3)
        .map(error => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`)
        .join("；");
}
