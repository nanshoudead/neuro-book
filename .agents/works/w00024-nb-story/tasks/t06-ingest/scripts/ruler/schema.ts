import { z } from "zod";

// V9 有两份结构。“草稿”是模型或标注者每章写的内容；“数据集”是程序把草稿编译后的成品。
// 两者分开，是为了让模型只写需要理解原文才能写的部分，定位、推导和核对都交给程序。

const text = z.string().min(1);
/** 抽取管线核对不了的记录写明原因（例如同一章两份草稿写法不一致），导出时提示作答者先读原文。模型写草稿时不用这个字段。 */
const unverified = text.optional();
const chapterNo = z.number().int().positive();

/** 原文位置：“章.段”，可带同章范围，例如 4.49 或 4.49-4.52（与题库的写法相同）。段号从 1 起，第 1 段是章名。 */
export const evidenceSchema = z.string().regex(/^\d{1,4}\.\d{1,4}(-(\d{1,4}\.)?\d{1,4})?$/u);
/** 单个段落位置，不带范围。 */
export const positionRefSchema = z.string().regex(/^\d{1,4}\.\d{1,4}$/u);

// 编号把章号写进去（e4-2 是第 4 章新建的第 2 个对象），所以全书唯一，后面章节引用时不会指错。
const idOf = (prefix: string) => z.string().regex(new RegExp(`^${prefix}\\d{1,4}-\\d{1,4}$`, "u"));
export const entityIdSchema = idOf("e");
export const statementIdSchema = idOf("s");
export const beatIdSchema = idOf("b");
export const timeIdSchema = idOf("t");
export const episodeIdSchema = idOf("p");
export const knowledgeIdSchema = idOf("k");
export const ledgerIdSchema = idOf("l");
export const questionIdSchema = idOf("q");
export const secretIdSchema = idOf("x");
export const arcIdSchema = idOf("a");

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

const basisSchema = z.enum(["explicit", "inferred"]);

const nameSchema = z.strictObject({
    text,
    at: positionRefSchema,
    /** 主要称呼：显示名取阅读位置之前最新的一个主要称呼。 */
    primary: z.boolean().optional(),
    /** 一句话说明谁在什么场合这样叫，例如“苏天晴对秘典的蔑称”。 */
    note: text.optional(),
});

const entityDraftSchema = z.strictObject({
    id: entityIdSchema,
    kind: z.enum(ENTITY_KINDS),
    /** 整理用的标签，不是书里的称呼；只能用首次出现时已知的信息，不能带后文才有的名字。 */
    label: text,
    at: positionRefSchema,
    note: text.optional(),
    names: z.array(nameSchema).default([]),
});

const nameAddSchema = nameSchema.extend({ entity: entityIdSchema });

/** 只标程序按名字匹配会认错的地方：同名不同对象、需要锚定的代称。 */
const mentionNoteSchema = z.strictObject({ at: positionRefSchema, text, entity: entityIdSchema });

const timeAnchorSchema = z.strictObject({
    id: timeIdSchema,
    label: text,
    /** 主线第几天；主线第一天是 1。主线开始之前的时间点不写。 */
    day: z.number().int().positive().optional(),
    part: z.enum(DAY_PARTS).optional(),
    clock: z.string().regex(/^\d{1,2}:\d{2}$/u).optional(),
    /** 原文给出的日历日期或星期。 */
    date: text.optional(),
    /** 钟点、日期比这个时间点本身交代得晚时，写明是哪一段交代的；在那之前查询不显示它。 */
    clockAt: positionRefSchema.optional(),
    dateAt: positionRefSchema.optional(),
    /** days 是相隔的整天数。草稿只写“比哪个时间点晚几天”，第几天由编译程序算出，模型自己累加天数容易错（t29 三次试跑把“翌日”记成第 1 天）。 */
    rel: z.array(z.strictObject({ type: z.enum(["after", "before", "same"]), to: timeIdSchema, gap: text.optional(), days: z.number().int().nonnegative().optional() })).default([]),
    at: z.array(evidenceSchema).default([]),
    basis: basisSchema.optional(),
    note: text.optional(),
});

const beatSchema = z.strictObject({
    id: beatIdSchema,
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    gist: text,
    /** 这一块讲的是哪个时间点；章名、作者声明这类副文本写 null。 */
    time: timeIdSchema.nullable(),
    /** 回忆、倒叙、补叙才写。 */
    narration: z.literal("flashback").optional(),
});

const sourceSchema = z.strictObject({
    at: z.array(evidenceSchema).min(1),
    ch: z.enum(CHANNELS),
    /** 说话人、想的人、文字的发布者；旁白和作者声明不写。来源不明写 null。 */
    by: entityIdSchema.nullable().optional(),
    /** 听到或读到这句话的人；程序据此生成“听说、读到”的知情。 */
    to: z.array(entityIdSchema).optional(),
    mode: z.enum(MODES).optional(),
});

const statementSchema = z.strictObject({
    id: statementIdSchema,
    text,
    family: z.enum(FAMILIES),
    label: text.optional(),
    /** 涉及的对象；讲世界整体而不针对具体对象的说法可以为空。 */
    about: z.array(entityIdSchema).default([]),
    src: sourceSchema,
    /** 不写时由程序按渠道给默认值：旁白是世界事实，心理是信念，台词和文字是说法。 */
    kind: z.enum(STATEMENT_KINDS).optional(),
    basis: basisSchema.optional(),
    premises: z.array(statementIdSchema).optional(),
    reason: text.optional(),
    /** 只是“可能”时写 candidate，例如尚未确认的身份。 */
    certainty: z.literal("candidate").optional(),
    /** 否定，例如“不是同一个人”。 */
    neg: z.boolean().optional(),
    /** 内容所指的故事时间；不写时取出处所在段落块的时间。 */
    time: timeIdSchema.optional(),
    /** 这条说法属于哪个秘密。 */
    secret: secretIdSchema.optional(),
    rel: z.array(z.strictObject({ type: z.enum(["confirms", "contradicts", "revises"]), to: statementIdSchema, note: text.optional() })).optional(),
    unverified,
});

const secretSchema = z.strictObject({
    id: secretIdSchema,
    title: text,
    about: z.array(entityIdSchema).min(1),
    /** 前面章节里已经表达过这个秘密的说法；本章的说法用它自己的 secret 字段指过来，不用列在这里。 */
    statements: z.array(statementIdSchema).optional(),
    note: text.optional(),
});

const episodeSchema = z.strictObject({
    id: episodeIdSchema,
    title: text,
    summary: text,
    at: z.array(evidenceSchema).min(1),
    time: timeIdSchema,
    place: entityIdSchema.optional(),
    /** 在场或参与的对象；as 是当时使用的身份（例如以风信子的身份出场）。 */
    who: z.array(z.strictObject({ e: entityIdSchema, as: entityIdSchema.optional(), role: text.optional() })).min(1),
    /** 一次性的动作和细节放在这里，不单独记成说法。 */
    steps: z.array(z.strictObject({ text, at: evidenceSchema })).default([]),
    outcome: text.optional(),
    links: z.array(z.strictObject({ type: z.enum(EPISODE_LINKS), to: episodeIdSchema, note: text.optional() })).default([]),
});

/** 给两个已有情节补一条连接：后文才看出的因果，或回忆里的事和主线情节之间的关系。读法和情节自带的连接相同：from 相对于 to。 */
const episodeLinkSchema = z.strictObject({ from: episodeIdSchema, type: z.enum(EPISODE_LINKS), to: episodeIdSchema, note: text.optional() });

const knowledgeSchema = z.strictObject({
    id: knowledgeIdSchema,
    who: z.union([entityIdSchema, z.literal("reader")]),
    about: z.union([statementIdSchema, secretIdSchema]),
    state: z.enum(KNOWLEDGE_STATES),
    how: text.optional(),
    at: z.array(evidenceSchema).min(1),
    basis: basisSchema.optional(),
    unverified,
});

const ledgerSchema = z.strictObject({
    id: ledgerIdSchema,
    owner: entityIdSchema,
    /** 同一个量全书用同一个名字，例如“神典石”“道具”“任务：夙愿”。 */
    track: text,
    op: z.enum(LEDGER_OPS),
    amount: z.number().positive().optional(),
    /** 变动后的值；数量类只在原文写出时才填，程序用它核对累加结果。 */
    value: z.union([z.number(), text]).optional(),
    item: entityIdSchema.optional(),
    reason: text,
    at: z.array(evidenceSchema).min(1),
    basis: basisSchema.optional(),
    unverified,
});

const questionSchema = z.strictObject({
    id: questionIdSchema,
    text,
    at: z.array(evidenceSchema).min(1),
    about: z.array(entityIdSchema).default([]),
    /** 书里是谁在问；不写表示读者层面的疑问。 */
    by: entityIdSchema.optional(),
});

const questionUpdateSchema = z.strictObject({
    q: questionIdSchema,
    type: z.enum(["raised", "partial", "answered"]),
    at: z.array(evidenceSchema).min(1),
    answer: statementIdSchema.optional(),
    note: text.optional(),
    reliability: z.enum(["narrator", "claim", "belief", "inferred"]).optional(),
});

/** 一章的草稿。 */
export const chapterDraftSchema = z.strictObject({
    chapter: chapterNo,
    times: z.array(timeAnchorSchema).default([]),
    beats: z.array(beatSchema).min(1),
    entities: z.array(entityDraftSchema).default([]),
    names: z.array(nameAddSchema).default([]),
    mentions: z.array(mentionNoteSchema).default([]),
    secrets: z.array(secretSchema).default([]),
    statements: z.array(statementSchema).default([]),
    episodes: z.array(episodeSchema).default([]),
    episodeLinks: z.array(episodeLinkSchema).default([]),
    knowledge: z.array(knowledgeSchema).default([]),
    ledger: z.array(ledgerSchema).default([]),
    questions: z.array(questionSchema).default([]),
    questionUpdates: z.array(questionUpdateSchema).default([]),
});

/** 草稿各部分单条记录的结构；抽取管线用它逐条检查模型输出，坏掉的一条不拖累整章。 */
export const draftSectionSchemas = {
    times: timeAnchorSchema, beats: beatSchema, entities: entityDraftSchema, names: nameAddSchema, mentions: mentionNoteSchema,
    secrets: secretSchema, statements: statementSchema, episodes: episodeSchema, episodeLinks: episodeLinkSchema, knowledge: knowledgeSchema, ledger: ledgerSchema,
    questions: questionSchema, questionUpdates: questionUpdateSchema,
} as const;
export type DraftSection = keyof typeof draftSectionSchemas;

const summaryItemSchema = z.strictObject({
    text,
    /** 这句概括依据哪些说法、情节、知情或状态变动；至少一条，方便展开核对。 */
    deps: z.array(z.union([statementIdSchema, episodeIdSchema, knowledgeIdSchema, ledgerIdSchema])).min(1),
});

/** 每隔若干章做一次的整理：合并重复对象、写对象摘要、归纳故事线。 */
export const consolidationSchema = z.strictObject({
    through: chapterNo,
    merges: z.array(z.strictObject({ keep: entityIdSchema, drop: entityIdSchema, reason: text })).default([]),
    summaries: z.array(z.strictObject({ entity: entityIdSchema, facet: z.enum(FACETS), items: z.array(summaryItemSchema).min(1) })).default([]),
    arcs: z.array(z.strictObject({ id: arcIdSchema, title: text, summary: text, episodes: z.array(episodeIdSchema).min(1), status: z.enum(["ongoing", "closed"]) })).default([]),
});

export type ChapterDraft = z.infer<typeof chapterDraftSchema>;
export type Consolidation = z.infer<typeof consolidationSchema>;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export type Family = (typeof FAMILIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Basis = z.infer<typeof basisSchema>;

// ---- 编译后的数据集 ----

export interface Position { chapter: number; paragraph: number }
export interface Span { chapter: number; from: number; to: number }

export interface SourceChapter { chapter: number; title: string; paragraphs: string[]; sha256: string }

export interface EntityName { text: string; at: Position; primary: boolean; note?: string }
export interface Entity {
    id: string; kind: EntityKind; label: string; note?: string; at: Position; names: EntityName[];
    /** 整理时被并入的对象编号。 */
    mergedFrom: string[];
}
/** 程序在原文里找到的一次称呼。via=note 表示由草稿指定了归属。 */
export interface Mention { entity: string; text: string; at: Position; start: number; end: number; via: "match" | "note" }
export interface TimeAnchor {
    id: string; label: string; day?: number; part?: (typeof DAY_PARTS)[number]; clock?: string; date?: string;
    /** 钟点、日期各自从哪里起可见；没有写就和时间点本身一起可见。 */
    clockAt?: Position; dateAt?: Position;
    rel: { type: "after" | "before" | "same"; to: string; gap?: string; days?: number }[]; evidence: Span[]; basis: Basis; note?: string;
    at: Position;
    /** 程序排出的故事先后次序，越小越早。 */
    order: number;
}
export interface Beat { id: string; chapter: number; from: number; to: number; gist: string; time: string | null; flashback: boolean; at: Position }
export interface Statement {
    id: string; text: string; family: Family; label?: string; about: string[];
    source: { evidence: Span[]; channel: Channel; by: string | null; to: string[]; mode: (typeof MODES)[number] };
    kind: StatementKind;
    /** 信念或说法的持有人；世界事实为 null。 */
    holder: string | null;
    basis: Basis; premises: string[]; reason?: string;
    certainty: "certain" | "candidate"; neg: boolean;
    time: string | null; secret?: string;
    rel: { type: "confirms" | "contradicts" | "revises"; to: string; note?: string }[];
    unverified?: string;
    at: Position;
}
export interface Secret { id: string; title: string; about: string[]; note?: string; statements: string[]; at: Position }
export interface Episode {
    id: string; title: string; summary: string; evidence: Span[]; time: string; place?: string;
    who: { e: string; as?: string; role?: string }[]; steps: { text: string; evidence: Span }[]; outcome?: string;
    /** 每条连接有自己的可见位置：情节自带的连接随情节可见，后面章节补的连接从补的那一章结束起可见。 */
    links: { type: (typeof EPISODE_LINKS)[number]; to: string; note?: string; at: Position }[]; at: Position;
}
export interface Knowledge {
    id: string; who: string; about: string; state: KnowledgeState; how?: string; evidence: Span[]; basis: Basis; unverified?: string; at: Position;
    /** 程序从说法的来源推出的知情，不是草稿写的。 */
    derived: boolean;
}
export interface LedgerEntry {
    id: string; owner: string; track: string; op: (typeof LEDGER_OPS)[number]; amount?: number; value?: number | string; item?: string;
    reason: string; evidence: Span[]; basis: Basis; unverified?: string; at: Position;
    /** 程序算出的变动后数值；只有数量类才有。 */
    running?: number;
    /** 原文给出的数值和累加结果是否一致；没有给出数值时为 null。 */
    check: "match" | "mismatch" | null;
}
export interface Question {
    id: string; text: string; evidence: Span[]; about: string[]; by?: string; at: Position;
    updates: { type: "raised" | "partial" | "answered"; evidence: Span[]; answer?: string; note?: string; reliability?: "narrator" | "claim" | "belief" | "inferred"; at: Position }[];
}
export interface Summary { entity: string; facet: (typeof FACETS)[number]; through: number; items: { text: string; deps: string[] }[]; at: Position }
export interface Arc { id: string; title: string; summary: string; episodes: string[]; status: "ongoing" | "closed"; through: number; at: Position }

export interface Issue { level: "error" | "warning"; chapter: number | null; code: string; message: string }

export interface Dataset {
    schema: "neurobook.memory.v9";
    book: { id: string; title: string };
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
    /** 各类记录里，草稿写了多少条、程序生成了多少条。 */
    stats: { written: Record<string, number>; generated: Record<string, number>; chars: number };
}
