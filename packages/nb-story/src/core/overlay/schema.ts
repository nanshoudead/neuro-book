/**
 * 修订文件的结构（docs/specs/story/revisions.md 的“副作用与数据”）。修订是对图的改动或决定，按书单独保存，
 * 不改抽取数据；`applyOverlay`（apply.ts）把它套到数据集上。
 *
 * 代码里把这一层叫 overlay：`BookMeta.revision` 已经是书的数据版本，不与修订混。
 */

import {Type} from "typebox";
import type {Static, TLiteral, TSchema, TUnion} from "typebox";
import {Compile} from "typebox/compile";

import {ENTITY_KINDS} from "../dataset";

export const OVERLAY_FORMAT = 1;

const Text = Type.String();
const Id = Type.String({minLength: 1});
const Pos = Type.Object({chapter: Type.Integer(), paragraph: Type.Integer()});
/** 字符串字面量的联合（写法同 dataset.ts）。 */
function oneOf<const T extends readonly string[]>(values: T): TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}> {
    return Type.Union(values.map(value => Type.Literal(value))) as unknown as TUnion<{-readonly [K in keyof T]: TLiteral<T[K]>}>;
}

export const REVISION_SOURCES = ["persona-check", "extraction", "user", "scan"] as const;
/** `pending` 给以后的扫描留：第一版没有人写这类存储项（待确认的候选是现算的）。 */
export const REVISION_STATES = ["adopted", "rejected", "withdrawn", "pending"] as const;

/** 修订所指目标的“锚”：重新抽取或整理之后据此认出同一个对象或说法（anchor.ts）。 */
export const AnchorSchema = Type.Union([
    Type.Object({type: Type.Literal("statement"), id: Id, at: Pos, text: Text}),
    Type.Object({type: Type.Literal("entity"), id: Id, at: Pos, firstName: Type.Union([Text, Type.Null()])}),
]);

const Base = {
    id: Id,
    state: oneOf(REVISION_STATES),
    source: oneOf(REVISION_SOURCES),
    /** 谁采纳的：`user`；`auto` 为以后“核对结果直接采纳”预留。 */
    by: Type.Union([Type.Literal("user"), Type.Literal("auto"), Type.Null()]),
    /** 依据位置：修订从这一段起生效。确认与驳回取说法自己的位置。 */
    evidence: Pos,
    anchors: Type.Array(AnchorSchema),
    reason: Type.Optional(Text),
    createdAt: Text,
    decidedAt: Type.Union([Text, Type.Null()]),
    history: Type.Array(Type.Object({at: Text, state: Text, note: Type.Optional(Text)})),
};

export const RevisionSchema = Type.Union([
    Type.Object({...Base, op: Type.Literal("identity.confirm"), params: Type.Object({statement: Id})}),
    Type.Object({...Base, op: Type.Literal("identity.reject"), params: Type.Object({statement: Id})}),
    Type.Object({...Base, op: Type.Literal("identity.link"), params: Type.Object({a: Id, b: Id, certainty: oneOf(["candidate", "certain"] as const), statement: Id})}),
    Type.Object({...Base, op: Type.Literal("kind.set"), params: Type.Object({entity: Id, kind: oneOf(ENTITY_KINDS)})}),
    Type.Object({...Base, op: Type.Literal("name.move"), params: Type.Object({text: Text, from: Id, to: Id})}),
]);

export const OverlayFileSchema = Type.Object({
    format: Type.Literal(OVERLAY_FORMAT),
    /** 它所属的书的一代的代号：读写只认与当前一代相同的文件。 */
    generation: Text,
    version: Type.Integer({minimum: 1}),
    items: Type.Array(RevisionSchema),
});

export type Anchor = Static<typeof AnchorSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type RevisionOp = Revision["op"];
export type RevisionState = (typeof REVISION_STATES)[number];
export type RevisionSource = (typeof REVISION_SOURCES)[number];
export type OverlayFile = Static<typeof OverlayFileSchema>;

let compiled: ReturnType<typeof Compile<TSchema>> | undefined;

/** 校验修订文件，返回前几处问题的说明；合格时为 null。 */
export function overlayProblems(value: unknown): string | null {
    compiled ??= Compile(OverlayFileSchema as TSchema);
    if (compiled.Check(value)) return null;
    return [...compiled.Errors(value)]
        .slice(0, 3)
        .map(error => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`)
        .join("；");
}
