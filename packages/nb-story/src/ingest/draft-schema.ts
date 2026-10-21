/**
 * 抽取草稿与整理稿的结构（docs/specs/story/ingest.md）。草稿是模型每章写的内容，编译程序（compile.ts）把各章草稿与
 * 整理稿编成数据集（core/dataset.ts）。两者分开，是为了让模型只写需要理解原文才能写的部分，定位、推导与核对都交给程序。
 *
 * 照搬 w00005 t27 `schema.ts` 的 zod 写法（字段、取值与注释不变），zod 的 `strictObject` 对应这里的
 * `additionalProperties: false`，`.default(x)` 对应 `default`：校验前先 `Value.Default` 补上默认值（见 `parseDraft`）。
 */

import {Type} from "typebox";
import type {Static, TLiteral, TSchema, TUnion} from "typebox";
import {Compile} from "typebox/compile";
import {Value} from "typebox/value";

import {CHANNELS, DAY_PARTS, ENTITY_KINDS, EPISODE_LINKS, FACETS, FAMILIES, KNOWLEDGE_STATES, LEDGER_OPS, MODES, STATEMENT_KINDS} from "../core/dataset";

function oneOf<const T extends readonly string[]>(values: T): TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}> {
    return Type.Union(values.map(value => Type.Literal(value))) as unknown as TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}>;
}

const strict = {additionalProperties: false} as const;
const text = Type.String({minLength: 1});
/** 抽取管线核对不了的记录写明原因；模型写草稿时不用这个字段（保留它是为了读 w00005 时期的草稿）。 */
const unverified = Type.Optional(text);
const chapterNo = Type.Integer({minimum: 1});
const positiveInt = Type.Integer({minimum: 1});

/** 原文位置：“章.段”，可带同章范围，例如 4.49 或 4.49-4.52。段号从 1 起，第 1 段是章名。 */
export const EVIDENCE_PATTERN = "^\\d{1,4}\\.\\d{1,4}(-(\\d{1,4}\\.)?\\d{1,4})?$";
const evidence = Type.String({pattern: EVIDENCE_PATTERN});
/** 单个段落位置，不带范围。 */
const positionRef = Type.String({pattern: "^\\d{1,4}\\.\\d{1,4}$"});

// 编号把章号写进去（e4-2 是第 4 章新建的第 2 个对象），所以全书唯一，后面章节引用时不会指错。
const idOf = (prefix: string) => Type.String({pattern: `^${prefix}\\d{1,4}-\\d{1,4}$`});
const entityId = idOf("e");
const statementId = idOf("s");
const beatId = idOf("b");
const timeId = idOf("t");
const episodeId = idOf("p");
const knowledgeId = idOf("k");
const ledgerId = idOf("l");
const questionId = idOf("q");
const secretId = idOf("x");
const arcId = idOf("a");

const basis = oneOf(["explicit", "inferred"] as const);
const list = <T extends TSchema>(item: T) => Type.Array(item, {default: []});

const name = {
    text,
    at: positionRef,
    /** 主要称呼：显示名取阅读位置之前最新的一个主要称呼。 */
    primary: Type.Optional(Type.Boolean()),
    /** 一句话说明谁在什么场合这样叫，例如“苏天晴对秘典的蔑称”。 */
    note: Type.Optional(text),
};
const NameSchema = Type.Object(name, strict);

const EntityDraftSchema = Type.Object({
    id: entityId,
    kind: oneOf(ENTITY_KINDS),
    /** 整理用的标签，不是书里的称呼；只能用首次出现时已知的信息，不能带后文才有的名字。 */
    label: text,
    at: positionRef,
    note: Type.Optional(text),
    names: list(NameSchema),
}, strict);

const NameAddSchema = Type.Object({...name, entity: entityId}, strict);

/** 只标程序按名字匹配会认错的地方：同名不同对象、需要锚定的代称。 */
const MentionNoteSchema = Type.Object({at: positionRef, text, entity: entityId}, strict);

const TimeAnchorDraftSchema = Type.Object({
    id: timeId,
    label: text,
    /** 主线第几天；主线第一天是 1。主线开始之前的时间点不写。 */
    day: Type.Optional(positiveInt),
    part: Type.Optional(oneOf(DAY_PARTS)),
    clock: Type.Optional(Type.String({pattern: "^\\d{1,2}:\\d{2}$"})),
    /** 原文给出的日历日期或星期。 */
    date: Type.Optional(text),
    /** 钟点、日期比这个时间点本身交代得晚时，写明是哪一段交代的；在那之前查询不显示它。 */
    clockAt: Type.Optional(positionRef),
    dateAt: Type.Optional(positionRef),
    /** days 是相隔的整天数。草稿只写“比哪个时间点晚几天”，第几天由编译程序算出。 */
    rel: list(Type.Object({type: oneOf(["after", "before", "same"] as const), to: timeId, gap: Type.Optional(text), days: Type.Optional(Type.Integer({minimum: 0}))}, strict)),
    at: list(evidence),
    basis: Type.Optional(basis),
    note: Type.Optional(text),
}, strict);

const BeatDraftSchema = Type.Object({
    id: beatId,
    from: positiveInt,
    to: positiveInt,
    gist: text,
    /** 这一块讲的是哪个时间点；章名、作者声明这类副文本写 null。 */
    time: Type.Union([timeId, Type.Null()]),
    /** 回忆、倒叙、补叙才写。 */
    narration: Type.Optional(Type.Literal("flashback")),
}, strict);

const SourceDraftSchema = Type.Object({
    at: Type.Array(evidence, {minItems: 1}),
    ch: oneOf(CHANNELS),
    /** 说话人、想的人、文字的发布者；旁白和作者声明不写。来源不明写 null。 */
    by: Type.Optional(Type.Union([entityId, Type.Null()])),
    /** 听到或读到这句话的人；程序据此生成“听说、读到”的知情。 */
    to: Type.Optional(Type.Array(entityId)),
    mode: Type.Optional(oneOf(MODES)),
}, strict);

const StatementDraftSchema = Type.Object({
    id: statementId,
    text,
    family: oneOf(FAMILIES),
    label: Type.Optional(text),
    /** 涉及的对象；讲世界整体而不针对具体对象的说法可以为空。 */
    about: list(entityId),
    src: SourceDraftSchema,
    /** 不写时由程序按渠道给默认值：旁白是世界事实，心理是信念，台词和文字是说法。 */
    kind: Type.Optional(oneOf(STATEMENT_KINDS)),
    basis: Type.Optional(basis),
    premises: Type.Optional(Type.Array(statementId)),
    reason: Type.Optional(text),
    /** 只是“可能”时写 candidate，例如尚未确认的身份。 */
    certainty: Type.Optional(Type.Literal("candidate")),
    /** 否定，例如“不是同一个人”。 */
    neg: Type.Optional(Type.Boolean()),
    /** 内容所指的故事时间；不写时取出处所在段落块的时间。 */
    time: Type.Optional(timeId),
    /** 这条说法属于哪个秘密。 */
    secret: Type.Optional(secretId),
    rel: Type.Optional(Type.Array(Type.Object({type: oneOf(["confirms", "contradicts", "revises"] as const), to: statementId, note: Type.Optional(text)}, strict))),
    unverified,
}, strict);

const SecretDraftSchema = Type.Object({
    id: secretId,
    title: text,
    about: Type.Array(entityId, {minItems: 1}),
    /** 前面章节里已经表达过这个秘密的说法；本章的说法用它自己的 secret 字段指过来，不用列在这里。 */
    statements: Type.Optional(Type.Array(statementId)),
    note: Type.Optional(text),
}, strict);

const EpisodeDraftSchema = Type.Object({
    id: episodeId,
    title: text,
    summary: text,
    at: Type.Array(evidence, {minItems: 1}),
    time: timeId,
    place: Type.Optional(entityId),
    /** 在场或参与的对象；as 是当时使用的身份（例如以风信子的身份出场）。 */
    who: Type.Array(Type.Object({e: entityId, as: Type.Optional(entityId), role: Type.Optional(text)}, strict), {minItems: 1}),
    /** 一次性的动作和细节放在这里，不单独记成说法。 */
    steps: list(Type.Object({text, at: evidence}, strict)),
    outcome: Type.Optional(text),
    links: list(Type.Object({type: oneOf(EPISODE_LINKS), to: episodeId, note: Type.Optional(text)}, strict)),
}, strict);

/** 给两个已有情节补一条连接：后文才看出的因果，或回忆里的事和主线情节之间的关系。读法和情节自带的连接相同：from 相对于 to。 */
const EpisodeLinkDraftSchema = Type.Object({from: episodeId, type: oneOf(EPISODE_LINKS), to: episodeId, note: Type.Optional(text)}, strict);

const KnowledgeDraftSchema = Type.Object({
    id: knowledgeId,
    who: Type.Union([entityId, Type.Literal("reader")]),
    about: Type.Union([statementId, secretId]),
    state: oneOf(KNOWLEDGE_STATES),
    how: Type.Optional(text),
    at: Type.Array(evidence, {minItems: 1}),
    basis: Type.Optional(basis),
    unverified,
}, strict);

const LedgerDraftSchema = Type.Object({
    id: ledgerId,
    owner: entityId,
    /** 同一个量全书用同一个名字，例如“神典石”“道具”“任务：夙愿”。 */
    track: text,
    op: oneOf(LEDGER_OPS),
    amount: Type.Optional(Type.Number({exclusiveMinimum: 0})),
    /** 变动后的值；数量类只在原文写出时才填，程序用它核对累加结果。 */
    value: Type.Optional(Type.Union([Type.Number(), text])),
    item: Type.Optional(entityId),
    reason: text,
    at: Type.Array(evidence, {minItems: 1}),
    basis: Type.Optional(basis),
    unverified,
}, strict);

const QuestionDraftSchema = Type.Object({
    id: questionId,
    text,
    at: Type.Array(evidence, {minItems: 1}),
    about: list(entityId),
    /** 书里是谁在问；不写表示读者层面的疑问。 */
    by: Type.Optional(entityId),
}, strict);

const QuestionUpdateDraftSchema = Type.Object({
    q: questionId,
    type: oneOf(["raised", "partial", "answered"] as const),
    at: Type.Array(evidence, {minItems: 1}),
    answer: Type.Optional(statementId),
    note: Type.Optional(text),
    reliability: Type.Optional(oneOf(["narrator", "claim", "belief", "inferred"] as const)),
}, strict);

/** 一章的草稿。 */
export const ChapterDraftSchema = Type.Object({
    chapter: chapterNo,
    times: list(TimeAnchorDraftSchema),
    beats: Type.Array(BeatDraftSchema, {minItems: 1}),
    entities: list(EntityDraftSchema),
    names: list(NameAddSchema),
    mentions: list(MentionNoteSchema),
    secrets: list(SecretDraftSchema),
    statements: list(StatementDraftSchema),
    episodes: list(EpisodeDraftSchema),
    episodeLinks: list(EpisodeLinkDraftSchema),
    knowledge: list(KnowledgeDraftSchema),
    ledger: list(LedgerDraftSchema),
    questions: list(QuestionDraftSchema),
    questionUpdates: list(QuestionUpdateDraftSchema),
}, strict);

/** 草稿各部分单条记录的结构；抽取管线用它逐条检查模型输出，坏掉的一条不拖累整章。 */
export const DRAFT_SECTION_SCHEMAS = {
    times: TimeAnchorDraftSchema, beats: BeatDraftSchema, entities: EntityDraftSchema, names: NameAddSchema, mentions: MentionNoteSchema,
    secrets: SecretDraftSchema, statements: StatementDraftSchema, episodes: EpisodeDraftSchema, episodeLinks: EpisodeLinkDraftSchema,
    knowledge: KnowledgeDraftSchema, ledger: LedgerDraftSchema, questions: QuestionDraftSchema, questionUpdates: QuestionUpdateDraftSchema,
} as const;
export type DraftSection = keyof typeof DRAFT_SECTION_SCHEMAS;
export const DRAFT_SECTIONS = Object.keys(DRAFT_SECTION_SCHEMAS) as DraftSection[];

const SummaryItemSchema = Type.Object({
    text,
    /** 这句概括依据哪些说法、情节、知情或状态变动；至少一条，方便展开核对。 */
    deps: Type.Array(Type.Union([statementId, episodeId, knowledgeId, ledgerId]), {minItems: 1}),
}, strict);

/**
 * 每隔若干章做一次的整理：合并重复对象、写对象摘要、归纳故事线。
 *
 * 两种写法（docs/specs/story/ingest.md 输出 7）：没有 `base` 的是 t12 之前的整批稿，`arcs` 就是这一批的全部主线；有
 * `base` 的是增量稿，`base` 是它接着的那一批主线的章号（还没有主线时为 0），`arcs` 里沿用那一批编号的是更新（`episodes`
 * 只写新归入的，可以为空），其余是新主线（至少一段情节，由编译检查）。`base` 由程序写入，不是模型写的。
 */
export const ConsolidationSchema = Type.Object({
    through: chapterNo,
    base: Type.Optional(Type.Integer({minimum: 0})),
    merges: list(Type.Object({keep: entityId, drop: entityId, reason: text}, strict)),
    summaries: list(Type.Object({entity: entityId, facet: oneOf(FACETS), items: Type.Array(SummaryItemSchema, {minItems: 1})}, strict)),
    arcs: list(Type.Object({id: arcId, title: text, summary: text, episodes: Type.Array(episodeId), status: oneOf(["ongoing", "closed"] as const)}, strict)),
}, strict);

export type ChapterDraft = Static<typeof ChapterDraftSchema>;
export type Consolidation = Static<typeof ConsolidationSchema>;

/** 一处结构问题：`path` 是 JSON 指针（整条记录为空串）。 */
export interface SchemaProblem {
    path: string;
    message: string;
}

export type Parsed<T> = {ok: true; value: T} | {ok: false; problems: SchemaProblem[]};

const checkers = new Map<TSchema, ReturnType<typeof Compile<TSchema>>>();

/**
 * 补上默认值后按结构校验。不修改传入的值；多出的字段算问题（与 zod 的 strictObject 相同），要去掉它们由调用方先
 * `Value.Clean`。
 */
export function parseWith<T extends TSchema>(schema: T, value: unknown): Parsed<Static<T>> {
    let checker = checkers.get(schema);
    if (!checker) {
        checker = Compile(schema as TSchema);
        checkers.set(schema, checker);
    }
    const candidate = Value.Default(schema, structuredClone(value));
    if (checker.Check(candidate)) return {ok: true, value: candidate as Static<T>};
    return {ok: false, problems: [...checker.Errors(candidate)].map(error => ({path: error.instancePath, message: error.message}))};
}
