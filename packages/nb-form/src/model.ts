/**
 * 把描述解析成字段树（docs/specs/ui/forms.md“输入与前置条件”与输出 1、2）：每个字段的路径、种类、提示、选项、
 * 是否必填与只读，以及选中的控件。
 *
 * 描述是 TypeBox 生成的、或手写的同等 JSON Schema；种类只看 schema 的结构，不看 TypeBox 的内部标记，所以手写的
 * `enum` 与 TypeBox 的字面量联合（`anyOf` 加 `const`）推出同一种类。表外的写法一律用 JSON 编辑，不让字段消失。
 */

import {toPointer} from "./path";
import type {FieldPath} from "./path";
import {isFormText} from "./text";
import type {FormText} from "./text";

/** 字段树展开的最深层数；更深的部分用 JSON 编辑，递归的 schema 也在这里停下。 */
export const MAX_DEPTH = 6;
/** 单选不超过这么多项时用横排单选组。 */
export const RADIO_ROW_LIMIT = 3;
/** 单选多于这么多项时用可搜索的下拉。 */
export const SEARCH_LIMIT = 15;

export type FieldKind = "boolean" | "choice" | "multi" | "number" | "text" | "string-list" | "object" | "object-list" | "json";

export const BUILTIN_WIDGETS = [
    "switch", "confirm",
    "radio-row", "radio", "select", "search-select",
    "checkboxes",
    "number",
    "text", "multiline", "secret",
    "string-list",
    "object",
    "object-list", "master-detail",
    "json",
] as const;
export type BuiltinWidget = (typeof BUILTIN_WIDGETS)[number];

/** 描述里能写的控件名（`radio-row` 是 3 项以内单选的缺省，不由作者写）。 */
const WRITABLE_WIDGETS = new Set<string>(["radio", "select", "search-select", "checkboxes", "multiline", "secret", "json", "list", "master-detail", "confirm"]);

export type ChoiceValue = string | number | boolean;

export interface FormChoice {
    readonly value: ChoiceValue;
    readonly label: FormText;
    readonly description?: FormText;
    readonly disabled?: boolean;
}

export interface VisibleWhen {
    /** 同一对象里的兄弟字段名；以 `/` 开头时是根上的 JSON Pointer。 */
    readonly field: string;
    readonly schema: Readonly<Record<string, unknown>>;
}

export interface FormHints {
    readonly label?: FormText;
    readonly help?: FormText;
    readonly placeholder?: FormText;
    readonly unit?: FormText;
    readonly widget?: string;
    readonly choices?: ReadonlyArray<FormChoice>;
    readonly options?: string;
    readonly searchable?: boolean;
    readonly visibleWhen?: VisibleWhen;
    readonly itemLabel?: string;
    readonly recommend?: ReadonlyArray<ChoiceValue>;
    readonly rows?: number;
}

/** 字段树里的 schema：普通 JSON 对象的视图。入口参数收任何对象（TypeBox 的类型没有索引签名）。 */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface FieldNode {
    readonly path: FieldPath;
    readonly kind: FieldKind;
    readonly schema: JsonSchema;
    readonly hints: FormHints;
    /** 字段的标题：`x-form.label`，没有时 `title`，再没有时属性名。 */
    readonly label: FormText;
    readonly help?: FormText;
    readonly required: boolean;
    /** 自己或某个父级写了 `readOnly`。 */
    readonly readOnly: boolean;
    /** `writeOnly`：密钥，值不回读。 */
    readonly writeOnly: boolean;
    /** `T` 与 `null` 的联合：清除写 `null`。 */
    readonly nullable: boolean;
    /** 单选与多选的选项（字面量与它们的名字）；动态选项的字段为空，选项由调用方给。 */
    readonly choices: ReadonlyArray<FormChoice>;
    readonly widget: BuiltinWidget | {readonly custom: string};
    /** 对象的成员，按属性顺序。 */
    readonly children: ReadonlyArray<FieldNode>;
    /** 列表的元素：路径末段是占位的 0，按实际下标替换（见 `itemNode`）。 */
    readonly item?: FieldNode;
}

export type FormLayout =
    | {readonly type: "field"; readonly path: string}
    | {readonly type: "column" | "row"; readonly items: ReadonlyArray<FormLayout>}
    | {readonly type: "group"; readonly label: FormText; readonly collapsed?: boolean; readonly items: ReadonlyArray<FormLayout>};

export interface FormModel {
    readonly schema: JsonSchema;
    readonly root: FieldNode;
    /** 显示用的布局：给了就用它（漏写的字段补在末尾），没给按属性顺序排成一列。 */
    readonly layout: FormLayout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChoiceValue(value: unknown): value is ChoiceValue {
    return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/** 字面量联合（`anyOf` 全是 `const`，或 `enum`）的取值；不是时为 null。 */
export function literalValues(input: object): ChoiceValue[] | null {
    const schema = input as JsonSchema;
    if (Array.isArray(schema.enum)) return schema.enum.length > 0 && schema.enum.every(isChoiceValue) ? [...schema.enum] : null;
    if (Object.hasOwn(schema, "const")) return isChoiceValue(schema.const) ? [schema.const] : null;
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        const values: ChoiceValue[] = [];
        for (const member of schema.anyOf) {
            if (!isRecord(member) || !Object.hasOwn(member, "const") || !isChoiceValue(member.const)) return null;
            values.push(member.const);
        }
        return values;
    }
    return null;
}

/** `T` 与 `{type: "null"}` 的联合里的 `T`；不是时为 null。 */
function nullableInner(schema: JsonSchema): JsonSchema | null {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2) return null;
    const isNull = (member: unknown) => isRecord(member) && member.type === "null";
    const [first, second] = schema.anyOf;
    if (isNull(first) && isRecord(second)) return second;
    if (isNull(second) && isRecord(first)) return first;
    return null;
}

function hasRef(schema: unknown): boolean {
    if (Array.isArray(schema)) return schema.some(hasRef);
    if (!isRecord(schema)) return false;
    if (Object.hasOwn(schema, "$ref") || Object.hasOwn(schema, "$defs") || Object.hasOwn(schema, "definitions")) return true;
    return Object.entries(schema).some(([key, value]) => key !== "x-form" && hasRef(value));
}

function isStructuredObject(schema: JsonSchema): boolean {
    return schema.type === "object" && isRecord(schema.properties) && Object.keys(schema.properties).length > 0
        && schema.patternProperties === undefined && (schema.additionalProperties === undefined || schema.additionalProperties === false);
}

/** 一个 schema 的种类（不看 `x-form`）。 */
export function kindOf(input: object, depth = 0): FieldKind {
    const schema = input as JsonSchema;
    if (depth >= MAX_DEPTH || hasRef(schema)) return "json";
    const inner = nullableInner(schema);
    if (inner !== null) return kindOf(inner, depth);
    if (literalValues(schema) !== null) return "choice";
    switch (schema.type) {
        case "boolean":
            return "boolean";
        case "number":
        case "integer":
            return "number";
        case "string":
            return "text";
        case "object":
            return isStructuredObject(schema) ? "object" : "json";
        case "array": {
            const items = schema.items;
            if (!isRecord(items) || Array.isArray(schema.prefixItems)) return "json";
            if (literalValues(items) !== null) return "multi";
            if (items.type === "string") return "string-list";
            if (items.type === "object" && isStructuredObject(items) && depth + 1 < MAX_DEPTH && !hasRef(items)) return "object-list";
            return "json";
        }
        default:
            return "json";
    }
}

/** 读 `x-form`：只留写法合格的键，形状不对的键丢掉（是否报问题由 `checkDescription` 决定）。 */
export function readHints(schema: JsonSchema): FormHints {
    const raw = schema["x-form"];
    if (!isRecord(raw)) return {};
    const hints: Record<string, unknown> = {};
    for (const key of ["label", "help", "placeholder", "unit"] as const) if (isFormText(raw[key])) hints[key] = raw[key];
    for (const key of ["widget", "options", "itemLabel"] as const) if (typeof raw[key] === "string" && raw[key] !== "") hints[key] = raw[key];
    if (typeof raw.searchable === "boolean") hints.searchable = raw.searchable;
    if (typeof raw.rows === "number" && Number.isInteger(raw.rows) && raw.rows > 0) hints.rows = raw.rows;
    if (Array.isArray(raw.choices)) {
        const choices = raw.choices.filter((choice): choice is FormChoice => isRecord(choice) && isChoiceValue(choice.value) && isFormText(choice.label));
        hints.choices = choices;
    }
    if (Array.isArray(raw.recommend)) hints.recommend = raw.recommend.filter(isChoiceValue);
    if (isRecord(raw.visibleWhen) && typeof raw.visibleWhen.field === "string" && isRecord(raw.visibleWhen.schema)) {
        hints.visibleWhen = {field: raw.visibleWhen.field, schema: raw.visibleWhen.schema};
    }
    return hints as FormHints;
}

/** 字面量与它们的名字：`x-form.choices` 按值（类型也要相同）对上，没对上的用值本身。 */
function choicesOf(values: ReadonlyArray<ChoiceValue>, hints: FormHints): FormChoice[] {
    return values.map((value) => {
        const named = hints.choices?.find((choice) => choice.value === value);
        return named === undefined ? {value, label: String(value)} : named;
    });
}

/** 按种类与提示选内建控件；写了不认识的名字时当作自定义控件，由渲染层的登记解析。 */
export function selectWidget(kind: FieldKind, hints: FormHints, schema: JsonSchema, choiceCount: number): FieldNode["widget"] {
    const asked = hints.widget;
    if (asked !== undefined && !WRITABLE_WIDGETS.has(asked) && !(BUILTIN_WIDGETS as readonly string[]).includes(asked)) return {custom: asked};
    switch (kind) {
        case "boolean":
            return asked === "confirm" ? "confirm" : "switch";
        case "choice": {
            if (asked === "radio" || asked === "select" || asked === "search-select") return asked;
            if (hints.searchable === true) return "search-select";
            // 动态选项的项数要到运行时才知道：缺省用下拉，项多时搜索由 `searchable` 打开。
            if (hints.options !== undefined) return "select";
            if (choiceCount > SEARCH_LIMIT) return "search-select";
            return choiceCount <= RADIO_ROW_LIMIT ? "radio-row" : "select";
        }
        case "multi":
            return "checkboxes";
        case "number":
            return "number";
        case "text":
            if (schema.writeOnly === true || asked === "secret") return "secret";
            // 动态选项的值是字符串：选项由调用方运行时给出（输出 11）。
            if (hints.options !== undefined) return asked === "search-select" || hints.searchable === true ? "search-select" : "select";
            return asked === "multiline" ? "multiline" : "text";
        case "string-list":
            return "string-list";
        case "object":
            return "object";
        case "object-list":
            return asked === "master-detail" ? "master-detail" : "object-list";
        case "json":
            return "json";
    }
}

interface BuildContext {
    readonly readOnly: boolean;
}

function buildNode(schema: JsonSchema, path: FieldPath, name: string, required: boolean, depth: number, context: BuildContext): FieldNode {
    const nullable = nullableInner(schema);
    const effective = nullable ?? schema;
    const hints = readHints(schema);
    const kind = kindOf(effective, depth);
    const readOnly = context.readOnly || schema.readOnly === true || effective.readOnly === true;
    const values = kind === "choice" ? literalValues(effective) ?? [] : kind === "multi" && isRecord(effective.items) ? literalValues(effective.items) ?? [] : [];
    const choices = choicesOf(values, hints);
    const children: FieldNode[] = [];
    let item: FieldNode | undefined;
    if (kind === "object" && isRecord(effective.properties)) {
        const requiredKeys = new Set(Array.isArray(effective.required) ? effective.required.filter((key): key is string => typeof key === "string") : []);
        for (const [key, child] of Object.entries(effective.properties)) {
            if (!isRecord(child)) continue;
            children.push(buildNode(child, [...path, key], key, requiredKeys.has(key), depth + 1, {readOnly}));
        }
    }
    if ((kind === "object-list" || kind === "string-list") && isRecord(effective.items)) {
        item = buildNode(effective.items, [...path, 0], "", true, depth + 1, {readOnly});
    }
    const titled = typeof effective.title === "string" ? effective.title : typeof schema.title === "string" ? schema.title : name;
    const described = typeof effective.description === "string" ? effective.description : typeof schema.description === "string" ? schema.description : undefined;
    const help = hints.help ?? described;
    return {
        path,
        kind,
        schema: effective,
        hints,
        label: hints.label ?? titled,
        ...(help === undefined ? {} : {help}),
        required,
        readOnly,
        writeOnly: effective.writeOnly === true || schema.writeOnly === true,
        nullable: nullable !== null,
        choices,
        widget: selectWidget(kind, hints, effective, choices.length),
        children,
        ...(item === undefined ? {} : {item}),
    };
}

/** 列表元素在实际下标上的字段：把模板里占位的下标换成 `index`。 */
export function itemNode(list: FieldNode, index: number): FieldNode | undefined {
    const template = list.item;
    if (template === undefined) return undefined;
    const position = list.path.length;
    const relocate = (node: FieldNode): FieldNode => ({
        ...node,
        path: node.path.map((segment, at) => (at === position ? index : segment)),
        children: node.children.map(relocate),
        ...(node.item === undefined ? {} : {item: relocate(node.item)}),
    });
    return relocate(template);
}

/** 按 JSON Pointer 找字段（布局用；列表里的字段不能单独放进布局）。 */
export function findNode(root: FieldNode, pointer: string): FieldNode | undefined {
    if (pointer === "") return root;
    const segments = pointer.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    let node: FieldNode | undefined = root;
    for (const segment of segments) {
        node = node?.children.find((child) => child.path[child.path.length - 1] === segment);
        if (node === undefined) return undefined;
    }
    return node;
}

function layoutFields(layout: FormLayout, into: Set<string>): void {
    if (layout.type === "field") into.add(layout.path);
    else for (const item of layout.items) layoutFields(item, into);
}

/** 解析描述。根不是对象时整张表单只有一个字段（根自己）。 */
export function resolveForm(input: object, options: {readonly layout?: FormLayout} = {}): FormModel {
    const schema = input as JsonSchema;
    const root = buildNode(schema, [], "", true, 0, {readOnly: false});
    const automatic: FormLayout = root.kind === "object"
        ? {type: "column", items: root.children.map((child) => ({type: "field", path: toPointer(child.path)}))}
        : {type: "column", items: [{type: "field", path: ""}]};
    if (options.layout === undefined) return {schema, root, layout: automatic};
    // 布局漏写的字段补在末尾：字段不会因为布局写漏而悄悄消失（checkDescription 另报一条）。
    const listed = new Set<string>();
    layoutFields(options.layout, listed);
    const missing = automatic.type === "column" ? automatic.items.filter((item) => item.type === "field" && !listed.has(item.path)) : [];
    const layout: FormLayout = missing.length === 0 ? options.layout : {type: "column", items: [options.layout, ...missing]};
    return {schema, root, layout};
}
