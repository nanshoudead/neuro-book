/**
 * 界面提示 `x-form` 的形状（docs/specs/ui/forms.md“输入与前置条件”）。读取（`readHints`）与检查（`hintProblems`）
 * 共用这一份 schema：读取时只留合格的键，检查时把不合格的键与数组项逐个报出来。新增提示键只改这里。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import {isRecord} from "./guards";
import {FormTextSchema} from "./text";

const ChoiceValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const ChoiceSchema = Type.Object({
    value: ChoiceValueSchema,
    label: FormTextSchema,
    description: Type.Optional(FormTextSchema),
    disabled: Type.Optional(Type.Boolean()),
});
const VisibleWhenSchema = Type.Object({
    /** 同一对象里的兄弟字段名；以 `/` 开头时是根上的 JSON Pointer。 */
    field: Type.String({minLength: 1}),
    schema: Type.Record(Type.String(), Type.Unknown()),
});

const HintsSchema = Type.Object({
    label: Type.Optional(FormTextSchema),
    help: Type.Optional(FormTextSchema),
    placeholder: Type.Optional(FormTextSchema),
    unit: Type.Optional(FormTextSchema),
    widget: Type.Optional(Type.String({minLength: 1})),
    /** 动态选项的来源名（输出 11）。 */
    options: Type.Optional(Type.String({minLength: 1})),
    itemLabel: Type.Optional(Type.String({minLength: 1})),
    searchable: Type.Optional(Type.Boolean()),
    rows: Type.Optional(Type.Integer({minimum: 1})),
    choices: Type.Optional(Type.Array(ChoiceSchema)),
    recommend: Type.Optional(Type.Array(ChoiceValueSchema)),
    visibleWhen: Type.Optional(VisibleWhenSchema),
});

/** 字面量选项能取的值。TypeBox 的 `Number` 不接受 `NaN` 与无穷，所以这里的数都是有限数。 */
export type ChoiceValue = Static<typeof ChoiceValueSchema>;
export type FormChoice = Readonly<Static<typeof ChoiceSchema>>;
export type VisibleWhen = Readonly<Static<typeof VisibleWhenSchema>>;

type RawHints = Static<typeof HintsSchema>;
/** 按联合的每一支分别处理（`T[] | undefined` 整体不是数组）：数组与数组项都只读。 */
type ReadonlyHint<T> = T extends ReadonlyArray<infer Item> ? ReadonlyArray<Readonly<Item>> : Readonly<T>;
/** 调用方可以交冻结的描述，拿到的提示也不该被改。 */
export type FormHints = {readonly [K in keyof RawHints]: ReadonlyHint<RawHints[K]>};

const HINT_KEYS = Object.keys(HintsSchema.properties) as Array<keyof FormHints>;

/** 数组提示逐项判断：一项写错只丢掉（或报出）那一项，不连累整组。 */
const HINT_ITEMS: Partial<Record<keyof FormHints, TSchema>> = {choices: ChoiceSchema, recommend: ChoiceValueSchema};

/** 读 schema 上的 `x-form`：只留形状合格的键，数组键只留合格的项。是否报问题由 `checkDescription` 决定。 */
export function readHints(schema: object): FormHints {
    const raw = (schema as Record<string, unknown>)["x-form"];
    if (!isRecord(raw)) return {};
    const hints: Record<string, unknown> = {};
    for (const key of HINT_KEYS) {
        const value = raw[key];
        if (value === undefined) continue;
        const item = HINT_ITEMS[key];
        if (item !== undefined && Array.isArray(value)) hints[key] = value.filter((entry) => Value.Check(item, entry));
        else if (Value.Check(HintsSchema.properties[key], value)) hints[key] = value;
    }
    return hints as FormHints;
}

export interface HintProblem {
    readonly code: "hints-not-object" | "unknown-hint" | "bad-hint";
    readonly params: Readonly<{key?: string; index?: number}>;
}

/** schema 上的 `x-form` 里不合格的地方：不是对象、不认识的键、形状不对的键；数组键逐项报。 */
export function hintProblems(schema: object): HintProblem[] {
    const raw = (schema as Record<string, unknown>)["x-form"];
    if (raw === undefined) return [];
    if (!isRecord(raw)) return [{code: "hints-not-object", params: {}}];
    const problems: HintProblem[] = [];
    for (const key of Object.keys(raw)) if (!Object.hasOwn(HintsSchema.properties, key)) problems.push({code: "unknown-hint", params: {key}});
    for (const key of HINT_KEYS) {
        const value = raw[key];
        if (value === undefined) continue;
        const item = HINT_ITEMS[key];
        if (item !== undefined && Array.isArray(value)) {
            value.forEach((entry, index) => {
                if (!Value.Check(item, entry)) problems.push({code: "bad-hint", params: {key, index}});
            });
        } else if (!Value.Check(HintsSchema.properties[key], value)) {
            problems.push({code: "bad-hint", params: {key}});
        }
    }
    return problems;
}
