import type {Prisma} from "nbook/server/generated/project-prisma/client";

/** 世界引擎唯一时间真相源：自世界零点起经过的秒数。 */
export type Instant = bigint;

/** JSON 可持久化值。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

/** mutation 支持的操作全集。 */
export type WorldMutationOp = "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove";

/** timeline subject 过滤模式：any=任一命中，all=全部命中。 */
export type WorldSliceSubjectFilterMode = "any" | "all";

/** subject 属性语义类型。 */
export type WorldAttrKind = "scalar" | "list" | "collection" | "object";

/** schema 中单个属性定义。 */
export type WorldAttrSchema = {
    kind?: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    fields?: Record<string, WorldAttrSchema>;
    default?: JsonValue;
    desc?: string;
};

/** schema 中单个 subject type 定义。 */
export type WorldSubjectTypeSchema = {
    desc?: string;
    attrs: Record<string, WorldAttrSchema>;
};

/** 项目级世界 schema。 */
export type WorldSchema = {
    subjectTypes: Record<string, WorldSubjectTypeSchema>;
};

/** 一条待写入变更。 */
export type MutationInput = {
    subjectId: string;
    attr: string;
    op: WorldMutationOp;
    value?: JsonValue;
};

/** 一个切面写入输入。 */
export type SliceInput = {
    instant: Instant;
    title?: string;
    summary?: string;
    kind?: string;
    mutations: MutationInput[];
};

/** 校验问题代号。
 *  E（持久，reduce 时现算）：broken-relative（相对 op 缺基）、dangling-ref（ref 目标不存在）。
 *  A（一次性，写操作返回）：base-shifted（插/改绝对 op 改了下游相对 op 的累加基）、masked（改动被下游绝对 set 覆盖）。*/
export type WorldIssueCode = "broken-relative" | "dangling-ref" | "base-shifted" | "masked";

/** 一条数据校验问题。sliceId：E 表示错误显形的切面；A 表示触发本次提醒的下游切面。 */
export type WorldIssue = {
    code: WorldIssueCode;
    sliceId?: string;
    subjectId: string;
    attr: string;
    message: string;
};

/** 写入或编辑切面后的结果：切面 id + 本次产生的问题（E + A）；edit 原样保存不重复返回 A。 */
export type SliceWriteResult = {
    sliceId: string;
    issues: WorldIssue[];
};

/** 删除切面后的结果：删后受影响 subject 重算出的持久问题（E）。 */
export type DeleteSliceResult = {
    issues: WorldIssue[];
};

/** 某 subject 在某个时刻 reduce 出来的状态。 */
export type SubjectState = {
    subjectId: string;
    type: string;
    attrs: Record<string, JsonValue>;
};

/** 某时刻的世界状态。issues：reduce 时现算的持久问题（E）。 */
export type WorldState = {
    instant: Instant;
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** 收窄查询结果。issues：reduce 时现算的持久问题（E）；传 attrs 时只返回相关属性问题。 */
export type QueryStateResult = {
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** timeline 切面列表项。issues：读时现算、归属到该切面的持久问题（E），不落库。 */
export type SliceListItem = {
    id: string;
    instant: Instant;
    previousInstant?: Instant;
    title: string;
    summary: string;
    kind: string;
    mutations?: MutationInput[];
    issues?: WorldIssue[];
};

/** subject 列表项。 */
export type WorldSubjectListItem = {
    id: string;
    type: string;
    name: string;
};

/** 创建 subject 的结果。issues：创建（非空 default 写 init slice）时产生的问题。 */
export type CreateWorldSubjectResult = {
    subjectId: string;
    issues: WorldIssue[];
};

/** Agent 友好的 schema 属性投影。 */
export type WorldSchemaProjectionAttr = {
    name: string;
    kind: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    default?: JsonValue;
    desc?: string;
    fields?: Record<string, WorldSchemaProjectionAttr>;
};

/** Agent 友好的 schema 投影。 */
export type WorldSchemaProjection = {
    subjectTypes: Array<{
        type: string;
        desc?: string;
        attrs: WorldSchemaProjectionAttr[];
    }>;
    calendar: {
        format: string;
        examples: string[];
    };
};

/** 世界引擎可用的 Prisma 执行器。 */
export type WorldPrismaExecutor = Prisma.TransactionClient | {
    worldSubject: Prisma.TransactionClient["worldSubject"];
    worldSlice: Prisma.TransactionClient["worldSlice"];
    worldMutation: Prisma.TransactionClient["worldMutation"];
};

/** 读取 mutation 时带上 subject type，避免 reduce 阶段反复查表。 */
export type WorldMutationRow = {
    id: string;
    sliceId: string;
    subjectId: string;
    instant: bigint;
    seq: number;
    attr: string;
    op: string;
    value: string | null;
};
