/**
 * 剧情图谱的查询接口合同：方法清单与每个方法参数、结果的 schema。行为见 docs/specs/story/queries.md 的“方法清单”
 * 与“输出与可观察行为”；结果里必须有的字段按那张表，这里可以多、不可以少。
 *
 * 同一份合同有三种用法：命令行在进程内调用（src/core/api.ts）、独立服务的 `POST /api/rpc/<方法名>`、以后插件通道的
 * `defineRemoteService`。参数一律是 `additionalProperties: false` 的对象，多余字段报 `invalid_params`。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {ENTITY_KINDS, FACETS, KNOWLEDGE_STATES, STATEMENT_KINDS} from "../core/dataset";

const strict = {additionalProperties: false} as const;

function oneOf<const T extends readonly string[]>(values: T) {
    return Type.Union(values.map(value => Type.Literal(value))) as unknown as ReturnType<typeof Type.Union<{-readonly [K in keyof T]: ReturnType<typeof Type.Literal<T[K]>>}>>;
}

// ---- 公共形状 ----

export const PositionInputSchema = Type.Object({chapter: Type.Integer(), paragraph: Type.Optional(Type.Integer())}, strict);
/** 结果里的阅读位置总是落到具体的段上。 */
export const PositionSchema = Type.Object({chapter: Type.Integer(), paragraph: Type.Integer()});
/** 出处：“38.57”或“38.50—38.81”。 */
export const RefSchema = Type.String();
export const EntityKindSchema = oneOf(ENTITY_KINDS);
/** 记录标记：明说（fact）、角色的说法（claim）、角色认为（belief），以及是否推断。知情记录指向秘密时 kind 为 null。 */
export const TagsSchema = Type.Object({kind: Type.Union([oneOf(STATEMENT_KINDS), Type.Null()]), inferred: Type.Boolean()});
/** 结果里引用的点（可能由几个对象合并而成）：id 是点的代表对象，label 是显示名。 */
export const NodeRefSchema = Type.Object({id: Type.String(), label: Type.String()});
/** 对秘密或身份说法的知情状态；“没有记录”与“明确不知道”不同。 */
export const AwarenessSchema = Type.Union([oneOf(KNOWLEDGE_STATES), Type.Literal("no-record")]);
export const IdentityStateSchema = oneOf(["uncertain", "unaware", "no-record", "heard", "believes", "suspects"] as const);

const Perspective = Type.String({minLength: 1});
const BookParams = {
    book: Type.Optional(Type.String({minLength: 1})),
    at: Type.Optional(PositionInputSchema),
    perspective: Type.Optional(Perspective),
};
const PageParams = {
    cursor: Type.Optional(Type.String({minLength: 1})),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 500})),
};

function page<T extends TSchema>(item: T) {
    return Type.Object({items: Type.Array(item), total: Type.Integer(), next: Type.Union([Type.String(), Type.Null()])});
}

const Empty = Type.Object({}, strict);

// ---- 书库与书 ----

const BookSummary = Type.Object({id: Type.String(), title: Type.String(), generation: Type.String(), chapters: Type.Integer(), extractedThrough: PositionSchema});

const BookInfo = Type.Object({
    id: Type.String(),
    title: Type.String(),
    generation: Type.String(),
    source: Type.Object({bookId: Type.String(), title: Type.String(), file: Type.String()}),
    chapters: Type.Integer(),
    paragraphs: Type.Array(Type.Integer()),
    /** P 所在章及之前各章有标题；之后的章 title 为 null。 */
    toc: Type.Array(Type.Object({chapter: Type.Integer(), title: Type.Union([Type.String(), Type.Null()])})),
    extractedThrough: PositionSchema,
    /** 这次查询实际用的阅读位置。 */
    at: PositionSchema,
});

const BookStats = Type.Object({
    at: PositionSchema,
    /** 到阅读位置为止各类可见记录的条数。 */
    visible: Type.Record(Type.String(), Type.Integer()),
    /** 全书抽取统计，不随阅读位置变。 */
    /** 第 1 章到阅读位置所在章，各章成立的可见记录数（输出 2）。 */
    chapters: Type.Array(Type.Object({
        chapter: Type.Integer(),
        statements: Type.Integer(),
        knowledge: Type.Integer(),
        episodes: Type.Integer(),
        ledger: Type.Integer(),
        /** 这一章新提出的悬念。 */
        raised: Type.Integer(),
        /** 这一章得到解答的悬念。 */
        answered: Type.Integer(),
    })),
    /** 出场最多的至多 12 个人物；`counts[i]` 是第 i+1 章里被提到的次数，长度与 `chapters` 相同。 */
    cast: Type.Array(Type.Object({id: Type.String(), label: Type.String(), counts: Type.Array(Type.Integer())})),
    extraction: Type.Object({scope: Type.Literal("book"), written: Type.Record(Type.String(), Type.Number()), generated: Type.Record(Type.String(), Type.Number()), chars: Type.Number()}),
});

const ReadingState = Type.Object({position: PositionInputSchema, view: Type.Unknown(), savedAt: Type.Union([Type.String(), Type.Null()])});

// ---- 对象 ----

const RosterItem = Type.Object({
    id: Type.String(),
    label: Type.String(),
    kind: EntityKindSchema,
    mentions: Type.Integer(),
    names: Type.Object({top: Type.Array(Type.String()), total: Type.Integer()}),
    /** 组成这个点的对象 id。 */
    entities: Type.Array(Type.String()),
});

const EntityCard = Type.Object({
    id: Type.String(),
    label: Type.String(),
    kind: EntityKindSchema,
    entities: Type.Array(Type.String()),
    names: Type.Array(Type.Object({text: Type.String(), ref: RefSchema})),
    /** 读者此时知道的同一身份：组成这个点的其它对象，各带连接成立的出处。 */
    identities: Type.Array(Type.Object({id: Type.String(), label: Type.String(), ref: RefSchema})),
    facets: Type.Array(Type.Object({facet: oneOf(FACETS), through: Type.Integer(), items: Type.Array(Type.String())})),
    secrets: Type.Array(Type.Object({id: Type.String(), title: Type.String(), state: AwarenessSchema, ref: Type.Union([RefSchema, Type.Null()])})),
    counts: Type.Object({relations: Type.Integer(), knowledge: Type.Integer(), statements: Type.Integer(), episodes: Type.Integer()}),
});

const KnowledgeItem = Type.Object({
    id: Type.String(),
    /** 知道了什么：说法的原文转述或秘密的标题。 */
    text: Type.String(),
    about: Type.Object({type: oneOf(["statement", "secret"] as const), id: Type.String()}),
    state: oneOf(KNOWLEDGE_STATES),
    how: Type.Union([Type.String(), Type.Null()]),
    refs: Type.Array(RefSchema),
    secret: Type.Boolean(),
    tags: TagsSchema,
    chapter: Type.Integer(),
});

const StatementItem = Type.Object({
    id: Type.String(),
    text: Type.String(),
    family: Type.String(),
    tags: TagsSchema,
    holder: Type.Union([NodeRefSchema, Type.Null()]),
    refs: Type.Array(RefSchema),
    chapter: Type.Integer(),
});

const EpisodeBrief = Type.Object({id: Type.String(), title: Type.String(), chapter: Type.Integer(), refs: Type.Array(RefSchema)});

// ---- 秘密、数值、悬念、时间、情节 ----

const SecretsMatrix = Type.Object({
    /** 读者一列在前；人物列的 `aliases` 是读者此时知道的他的其他身份名（读者列为空）。 */
    columns: Type.Array(Type.Object({id: Type.String(), label: Type.String(), aliases: Type.Array(Type.String())})),
    rows: Type.Array(
        Type.Object({
            id: Type.String(),
            title: Type.String(),
            /** 读者知道这个秘密的出处；读者还不知道时为 null。 */
            revealedAt: Type.Union([RefSchema, Type.Null()]),
            /** `how` 是取到的那条记录写的“怎么知道的”；读者凭身份说法知道时为“旁白”；没有记录时为 null。 */
            cells: Type.Array(Type.Object({column: Type.String(), state: AwarenessSchema, how: Type.Union([Type.String(), Type.Null()]), ref: Type.Union([RefSchema, Type.Null()])})),
        }),
    ),
});

const TrackKind = oneOf(["resource", "task", "item"] as const);
const LedgerTrack = Type.Object({
    name: Type.String(),
    owner: NodeRefSchema,
    kind: TrackKind,
    current: Type.Union([Type.Number(), Type.String(), Type.Null()]),
    relative: Type.Boolean(),
    lastRef: RefSchema,
    /** 原文报数与累加对不上的笔数。 */
    mismatches: Type.Integer(),
    entries: Type.Integer(),
});
const LedgerEntry = Type.Object({
    id: Type.String(),
    op: Type.String(),
    change: Type.Union([Type.Number(), Type.Null()]),
    value: Type.Union([Type.Number(), Type.String(), Type.Null()]),
    item: Type.Union([NodeRefSchema, Type.Null()]),
    balance: Type.Union([Type.Number(), Type.Null()]),
    relative: Type.Boolean(),
    gap: Type.Union([Type.Number(), Type.Null()]),
    reason: Type.String(),
    refs: Type.Array(RefSchema),
});

const QuestionState = oneOf(["open", "partial", "answered"] as const);
const QuestionItem = Type.Object({
    id: Type.String(),
    text: Type.String(),
    state: QuestionState,
    trivial: Type.Boolean(),
    about: Type.Array(NodeRefSchema),
    raised: Type.Object({refs: Type.Array(RefSchema), chapter: Type.Integer()}),
    updates: Type.Array(Type.Object({type: oneOf(["raised", "partial", "answered"] as const), answer: Type.Union([Type.String(), Type.Null()]), note: Type.Union([Type.String(), Type.Null()]), refs: Type.Array(RefSchema), chapter: Type.Integer()})),
    /** 出处与提出或可见进展的出处重叠的情节，按章排序（输出 11）。 */
    episodes: Type.Array(EpisodeBrief),
});

const TimelinePoint = Type.Object({
    id: Type.String(),
    label: Type.String(),
    day: Type.Union([Type.Number(), Type.Null()]),
    part: Type.Union([Type.String(), Type.Null()]),
    clock: Type.Union([Type.String(), Type.Null()]),
    date: Type.Union([Type.String(), Type.Null()]),
    /** 相对时间的说明，例如“t3-3 之后 2 天”；没有时为 null。 */
    relative: Type.Union([Type.String(), Type.Null()]),
    /** 故事时间更早、却在后面的章才写到：给出写到它的那一章；不是补叙时为 null。 */
    flashback: Type.Union([Type.Integer(), Type.Null()]),
    refs: Type.Array(RefSchema),
    chapter: Type.Integer(),
    /** 故事时间是这个点的可见情节（输出 12）。 */
    episodes: Type.Array(Type.Object({id: Type.String(), title: Type.String(), who: Type.Array(NodeRefSchema), place: Type.Union([NodeRefSchema, Type.Null()])})),
});

const EpisodeLinkType = oneOf(["after", "continues", "retells", "causes", "motivates", "enables"] as const);
const EpisodeItem = Type.Object({
    id: Type.String(),
    title: Type.String(),
    chapter: Type.Integer(),
    /** 参与者；`as` 是读者此时认得出的出场身份（例如“风信子”），没有或还认不出时为 null（输出 13）。 */
    who: Type.Array(Type.Object({id: Type.String(), label: Type.String(), as: Type.Union([Type.String(), Type.Null()])})),
    place: Type.Union([NodeRefSchema, Type.Null()]),
    /** 所挂的时间点；不可见时为 null。 */
    time: Type.Union([Type.Object({id: Type.String(), label: Type.String()}), Type.Null()]),
    summary: Type.String(),
    steps: Type.Array(Type.Object({text: Type.String(), ref: RefSchema})),
    outcome: Type.Union([Type.String(), Type.Null()]),
    links: Type.Array(Type.Object({type: EpisodeLinkType, to: Type.Object({id: Type.String(), title: Type.String()}), note: Type.Union([Type.String(), Type.Null()])})),
    /** 所属主线（当前这一批里的 id，可以有几条）；为空表示“未归入主线”。 */
    arcs: Type.Array(Type.String()),
    refs: Type.Array(RefSchema),
});

const ArcsList = Type.Object({
    /** 当前这一批归纳到第几章；还没有任何一批时为 null。 */
    through: Type.Union([Type.Integer(), Type.Null()]),
    arcs: Type.Array(Type.Object({id: Type.String(), title: Type.String(), summary: Type.String(), status: oneOf(["ongoing", "closed"] as const), episodes: Type.Array(Type.String())})),
});

const ChapterDigest = Type.Object({
    chapter: Type.Integer(),
    title: Type.String(),
    episodes: Type.Array(Type.Object({id: Type.String(), title: Type.String(), summary: Type.String(), refs: Type.Array(RefSchema)})),
    newEntities: Type.Array(Type.Object({id: Type.String(), label: Type.String(), kind: EntityKindSchema, ref: RefSchema})),
    revealedSecrets: Type.Array(Type.Object({id: Type.String(), title: Type.String(), ref: RefSchema})),
    ledger: Type.Array(Type.Object({track: Type.String(), owner: NodeRefSchema, op: Type.String(), change: Type.Union([Type.Number(), Type.Null()]), value: Type.Union([Type.Number(), Type.String(), Type.Null()]), ref: RefSchema})),
    questions: Type.Object({
        raised: Type.Array(Type.Object({id: Type.String(), text: Type.String(), ref: RefSchema})),
        progressed: Type.Array(Type.Object({id: Type.String(), text: Type.String(), type: oneOf(["partial", "answered"] as const), ref: RefSchema})),
    }),
});

// ---- 原文与搜索 ----

const SourceParagraph = Type.Object({
    chapter: Type.Integer(),
    paragraph: Type.Integer(),
    text: Type.String(),
    names: Type.Array(Type.Object({entity: Type.String(), text: Type.String(), start: Type.Integer(), end: Type.Integer()})),
    /** 从这一段开始的段落概要；没有或还不完整时为 null。 */
    beat: Type.Union([Type.Object({id: Type.String(), gist: Type.String(), from: Type.Integer(), to: Type.Integer()}), Type.Null()]),
    recordCount: Type.Integer(),
});

const RecordItem = Type.Object({
    type: oneOf(["statement", "knowledge", "episode", "ledger", "question", "time", "secret"] as const),
    id: Type.String(),
    text: Type.String(),
    tags: Type.Union([TagsSchema, Type.Null()]),
    refs: Type.Array(RefSchema),
});

const SearchKind = oneOf(["entity", "statement", "source"] as const);
const SearchItem = Type.Object({
    kind: SearchKind,
    /** 对象的点 id、说法 id；原文为 null。 */
    id: Type.Union([Type.String(), Type.Null()]),
    text: Type.String(),
    ref: RefSchema,
});

// ---- 图 ----

export const RelationNodeSchema = Type.Object({id: Type.String(), label: Type.String(), kind: EntityKindSchema, mentions: Type.Integer(), entities: Type.Array(Type.String())});
export const RelationEdgeSchema = Type.Object({
    a: Type.String(),
    b: Type.String(),
    relation: Type.Union([Type.Object({word: Type.Union([Type.String(), Type.Null()]), statements: Type.Integer()}), Type.Null()]),
    together: Type.Integer(),
    knows: Type.Union([Type.Object({ab: Type.Integer(), ba: Type.Integer()}), Type.Null()]),
    identity: Type.Union([IdentityStateSchema, Type.Null()]),
});
const RelationGraph = Type.Object({
    nodes: Type.Array(RelationNodeSchema),
    edges: Type.Array(RelationEdgeSchema),
    view: Type.Object({
        perspective: Type.String(),
        statements: Type.Integer(),
        unmerged: Type.Array(Type.Object({a: Type.String(), b: Type.String(), identity: IdentityStateSchema})),
    }),
    /** 这个位置可选的视角：至少有一条知情记录的人物。 */
    perspectives: Type.Array(NodeRefSchema),
});

const BookGraph = Type.Object({
    nodes: Type.Array(Type.Object({id: Type.String(), type: oneOf(["entity", "arc", "episode", "secret", "question"] as const), label: Type.String(), weight: Type.Integer()})),
    edges: Type.Array(Type.Object({a: Type.String(), b: Type.String(), type: oneOf(["participates", "about", "link", "relation"] as const), count: Type.Integer()})),
});

const Storyline = Type.Object({
    lanes: Type.Array(NodeRefSchema),
    dots: Type.Array(Type.Object({episode: Type.String(), title: Type.String(), chapter: Type.Integer(), lane: Type.String()})),
});

// ---- 方法清单 ----

const BookErrors = {book_not_found: Type.Object({}), book_ambiguous: Type.Object({}), position_out_of_range: Type.Object({}), invalid_params: Type.Object({})};
const EntityErrors = {...BookErrors, entity_not_found: Type.Object({}), entity_ambiguous: Type.Object({candidates: Type.Array(Type.Object({id: Type.String(), label: Type.String(), note: Type.String()}))})};
const PageErrors = {cursor_invalid: Type.Object({})};

export const STORY_METHODS = {
    "books.list": {input: Empty, output: Type.Object({books: Type.Array(BookSummary)}), effect: "read", errors: {invalid_params: Type.Object({})}},
    "book.import": {
        input: Type.Object({file: Type.String({minLength: 1}), title: Type.String({minLength: 1}), id: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({id: Type.String(), generation: Type.String()}),
        effect: "write",
        errors: {book_exists: Type.Object({}), unsupported_format: Type.Object({}), invalid_params: Type.Object({})},
    },
    "book.remove": {input: Type.Object({book: Type.String({minLength: 1})}, strict), output: Empty, effect: "write", errors: {book_not_found: Type.Object({}), unsupported_format: Type.Object({}), invalid_params: Type.Object({})}},
    "book.info": {input: Type.Object({...BookParams}, strict), output: BookInfo, effect: "read", errors: BookErrors},
    "book.stats": {input: Type.Object({...BookParams}, strict), output: BookStats, effect: "read", errors: BookErrors},
    "reading.get": {input: Type.Object({book: BookParams.book}, strict), output: ReadingState, effect: "read", errors: BookErrors},
    "reading.set": {
        input: Type.Object({book: BookParams.book, position: PositionInputSchema, view: Type.Unknown()}, strict),
        output: ReadingState,
        effect: "write",
        errors: {...BookErrors, state_too_large: Type.Object({}), unsupported_format: Type.Object({})},
    },
    "chapter.digest": {input: Type.Object({...BookParams, chapter: Type.Integer()}, strict), output: ChapterDigest, effect: "read", errors: {...BookErrors, beyond_position: Type.Object({})}},
    "entities.list": {
        input: Type.Object({...BookParams, ...PageParams, kind: Type.Optional(EntityKindSchema), query: Type.Optional(Type.String())}, strict),
        output: page(RosterItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "entity.card": {input: Type.Object({...BookParams, entity: Type.String({minLength: 1})}, strict), output: EntityCard, effect: "read", errors: EntityErrors},
    "entity.knowledge": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), state: Type.Optional(oneOf(KNOWLEDGE_STATES)), query: Type.Optional(Type.String())}, strict),
        output: page(KnowledgeItem),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "entity.statements": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), query: Type.Optional(Type.String())}, strict),
        output: page(StatementItem),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "entity.episodes": {
        input: Type.Object({...BookParams, ...PageParams, entity: Type.String({minLength: 1}), query: Type.Optional(Type.String())}, strict),
        output: page(EpisodeBrief),
        effect: "read",
        errors: {...EntityErrors, ...PageErrors},
    },
    "secrets.matrix": {input: Type.Object({...BookParams}, strict), output: SecretsMatrix, effect: "read", errors: BookErrors},
    "ledger.tracks": {input: Type.Object({...BookParams}, strict), output: Type.Object({tracks: Type.Array(LedgerTrack)}), effect: "read", errors: BookErrors},
    "ledger.track": {
        input: Type.Object({...BookParams, track: Type.String({minLength: 1}), owner: Type.Optional(Type.String({minLength: 1}))}, strict),
        output: Type.Object({track: LedgerTrack, entries: Type.Array(LedgerEntry)}),
        effect: "read",
        errors: {...EntityErrors},
    },
    "questions.list": {
        input: Type.Object({...BookParams, ...PageParams, state: Type.Optional(QuestionState), query: Type.Optional(Type.String()), sort: Type.Optional(oneOf(["recent", "raised"] as const))}, strict),
        output: page(QuestionItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    timeline: {input: Type.Object({...BookParams, order: Type.Optional(oneOf(["story", "source"] as const))}, strict), output: Type.Object({points: Type.Array(TimelinePoint)}), effect: "read", errors: BookErrors},
    "episodes.list": {
        input: Type.Object({...BookParams, ...PageParams, arc: Type.Optional(Type.String({minLength: 1})), query: Type.Optional(Type.String())}, strict),
        output: page(EpisodeItem),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "arcs.list": {input: Type.Object({...BookParams}, strict), output: ArcsList, effect: "read", errors: BookErrors},
    "source.read": {
        input: Type.Object({...BookParams, from: PositionInputSchema, to: Type.Optional(PositionInputSchema)}, strict),
        output: Type.Object({paragraphs: Type.Array(SourceParagraph)}),
        effect: "read",
        errors: {...BookErrors, beyond_position: Type.Object({})},
    },
    "source.records": {
        input: Type.Object({...BookParams, chapter: Type.Integer(), paragraph: Type.Integer()}, strict),
        output: Type.Object({records: Type.Array(RecordItem)}),
        effect: "read",
        errors: {...BookErrors, beyond_position: Type.Object({})},
    },
    search: {
        input: Type.Object({...BookParams, ...PageParams, query: Type.String({minLength: 1}), kinds: Type.Optional(Type.Array(SearchKind))}, strict),
        output: Type.Object({...page(SearchItem).properties, counts: Type.Object({entity: Type.Integer(), statement: Type.Integer(), source: Type.Integer()})}),
        effect: "read",
        errors: {...BookErrors, ...PageErrors},
    },
    "graph.relations": {
        input: Type.Object({...BookParams, kinds: Type.Optional(Type.Array(EntityKindSchema)), minTogether: Type.Optional(Type.Integer({minimum: 1}))}, strict),
        output: RelationGraph,
        effect: "read",
        errors: EntityErrors,
    },
    "graph.book": {
        input: Type.Object({...BookParams, grain: Type.Optional(oneOf(["arc", "episode"] as const)), types: Type.Optional(Type.Array(oneOf(["entity", "arc", "episode", "secret", "question"] as const)))}, strict),
        output: BookGraph,
        effect: "read",
        errors: BookErrors,
    },
    "graph.storyline": {input: Type.Object({...BookParams}, strict), output: Storyline, effect: "read", errors: BookErrors},
} as const;

export type StoryMethods = typeof STORY_METHODS;
export type StoryMethod = keyof StoryMethods;
export type StoryParams<M extends StoryMethod> = Static<StoryMethods[M]["input"]>;
export type StoryResult<M extends StoryMethod> = Static<StoryMethods[M]["output"]>;

export type PositionInput = Static<typeof PositionInputSchema>;
export type Ref = Static<typeof RefSchema>;
export type Tags = Static<typeof TagsSchema>;
export type NodeRef = Static<typeof NodeRefSchema>;
export type Awareness = Static<typeof AwarenessSchema>;
export type IdentityState = Static<typeof IdentityStateSchema>;
export type RelationNode = Static<typeof RelationNodeSchema>;
export type RelationEdge = Static<typeof RelationEdgeSchema>;

/**
 * 以后接进 NeuroBook 时插件通道用的同一份合同。独立服务与命令行不经过插件通道，只用 STORY_METHODS。
 */
export const storyContract = defineRemoteService({
    id: "nb-story/queries",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: STORY_METHODS,
});
