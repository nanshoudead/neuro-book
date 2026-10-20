/**
 * 校验与问题（docs/specs/ui/forms.md 输出 7–10）。
 *
 * 不把 TypeBox 的错误直接换成问题：它的必填错误报在父对象上、缺两个字段只有一条，字面量联合一个值报好几条，路径
 * 也不转义。所以沿字段树逐个字段校验：
 * - 必填由这里按对象的 `required` 展开到缺的那个字段（包括 `required` 里有、`properties` 里没有的键）；
 * - 每个字段自己 schema 上作用在它本身的全部约束都报（对象的 `minProperties`、数组的 `contains` 等），只是字面量
 *   联合的分支错误压成一条 `not-in-choices`；
 * - 成员由字段树各自校验；
 * - 最后对整值检查一次，字段树没有表达的约束（JSON 字段与引用里的）按路径归到 JSON 字段上，归不了的记在根上；
 *   必填与额外属性已由字段树处理，整值检查不再重复报。
 * 任何 TypeBox 调用的异常（例如写错的正则）记为出错的那个字段上的 `schema-error`，不抛出。
 */

import {Value} from "typebox/value";

import type {ChoiceValue, FieldNode, FormModel, JsonSchema} from "./model";
import {itemNode} from "./model";
import {toPointer} from "./path";
import {walkSchema} from "./schema-walk";
import type {FieldPath} from "./path";
import type {FormText} from "./text";

export interface FormIssue {
    readonly path: FieldPath;
    readonly code: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly severity: "error" | "warning";
    readonly source: "schema" | "caller";
    /** 调用方的问题可以带文字；schema 的问题按 `code` 与 `params` 在显示时写出。 */
    readonly message?: FormText;
}

/** 按路径给出值之外的状态（输出 10）。键是 JSON Pointer。 */
export type FormMeta = Readonly<Record<string, {readonly secret?: "set" | "unset" | "unreadable"}>>;

/** TypeBox 的关键字到问题码；不在表里的用关键字本身。 */
const CODES: Readonly<Record<string, string>> = {
    type: "type",
    minLength: "min-length",
    maxLength: "max-length",
    pattern: "pattern",
    format: "format",
    minimum: "minimum",
    exclusiveMinimum: "minimum",
    maximum: "maximum",
    exclusiveMaximum: "maximum",
    multipleOf: "multiple-of",
    minItems: "min-items",
    maxItems: "max-items",
    uniqueItems: "unique-items",
    contains: "contains",
    minProperties: "min-properties",
    maxProperties: "max-properties",
    dependentRequired: "dependent-required",
    const: "not-in-choices",
    enum: "not-in-choices",
    anyOf: "not-in-choices",
    required: "required",
    additionalProperties: "additional-property",
};

interface TypeBoxError {
    readonly keyword: string;
    readonly schemaPath: string;
    readonly instancePath: string;
    readonly params: unknown;
}

function issue(path: FieldPath, code: string, params: Readonly<Record<string, unknown>> = {}): FormIssue {
    return {path, code, params, severity: "error", source: "schema"};
}

function failure(path: FieldPath, error: unknown): FormIssue {
    return issue(path, "schema-error", {detail: error instanceof Error ? error.message : String(error)});
}

function hasReference(schema: JsonSchema): boolean {
    let found = false;
    walkSchema(schema, ({node}) => {
        if (Object.hasOwn(node, "$ref") || Object.hasOwn(node, "$dynamicRef")) found = true;
    });
    return found;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorsOf(schema: JsonSchema, value: unknown): {readonly errors: ReadonlyArray<TypeBoxError>} | {readonly failed: unknown} {
    try {
        return {errors: Value.Errors(schema, value) as ReadonlyArray<TypeBoxError>};
    } catch (error) {
        return {failed: error};
    }
}

/**
 * 一个值在它自己的 schema 下、作用在值本身（`instancePath` 为空）的约束问题，同一个码只报一次。`skip` 里的码由调用
 * 方另行处理。字面量联合的分支错误（`schemaPath` 里带 `anyOf/<n>`）不单独报。
 */
function ownIssues(schema: JsonSchema, value: unknown, path: FieldPath, skip: ReadonlySet<string>): FormIssue[] {
    const result = errorsOf(schema, value);
    if ("failed" in result) return [failure(path, result.failed)];
    const issues: FormIssue[] = [];
    const seen = new Set<string>();
    for (const error of result.errors) {
        if (error.instancePath !== "" || /\/anyOf\/\d+/u.test(error.schemaPath)) continue;
        const code = CODES[error.keyword] ?? error.keyword;
        if (skip.has(code) || seen.has(code)) continue;
        seen.add(code);
        issues.push(issue(path, code, error.params as Record<string, unknown>));
    }
    return issues;
}

/**
 * 对象与列表的 schema 去掉成员结构后只剩作用在自身的约束：成员由字段树各自校验，成员里的异常（例如写错的正则）
 * 也只报在成员上，不会在父级再报一次。
 */
function shallow(schema: JsonSchema): JsonSchema {
    const {properties: _properties, required: _required, additionalProperties: _additional, patternProperties: _patterns, items: _items, prefixItems: _prefix, ...own} = schema;
    return own;
}

const CHOICE_CODES = new Set(["not-in-choices", "type"]);
const OBJECT_CODES = new Set(["required", "additional-property", "type"]);
const LIST_CODES = new Set(["type"]);

/** 字段的路径在 TypeBox `instancePath` 里的写法（不转义），用来把整值检查的错误归到 JSON 字段上。 */
function rawPointer(path: FieldPath): string {
    return path.map((segment) => `/${String(segment)}`).join("");
}

interface WalkContext {
    readonly meta: FormMeta;
    readonly issues: FormIssue[];
    /** 用 JSON 编辑的字段的不转义路径：整值检查的错误据此归位。 */
    readonly jsonFields: Array<{readonly raw: string; readonly path: FieldPath}>;
}

function walk(node: FieldNode, value: unknown, context: WalkContext): void {
    const {path} = node;
    const {issues} = context;
    if (value === undefined) return;
    if (node.kind === "json") {
        context.jsonFields.push({raw: rawPointer(path), path});
        // 有引用的子 schema 离开根就解析不了（TypeBox 把找不到的引用当成恒假）：交给整值检查，在那里按路径归到
        // 这个字段。
        if (hasReference(node.schema)) return;
        const result = errorsOf(node.schema, value);
        if ("failed" in result) {
            issues.push(failure(path, result.failed));
            return;
        }
        const seen = new Set<string>();
        for (const error of result.errors) {
            if (/\/anyOf\/\d+/u.test(error.schemaPath)) continue;
            const code = CODES[error.keyword] ?? error.keyword;
            const key = `${code}:${error.instancePath}`;
            if (seen.has(key)) continue;
            seen.add(key);
            issues.push(issue(path, code, {...(error.params as Record<string, unknown>), at: error.instancePath}));
        }
        return;
    }
    if (value === null) {
        if (!node.nullable) issues.push(issue(path, "type", {type: node.schema.type ?? "value"}));
        return;
    }
    switch (node.kind) {
        case "object": {
            if (!isPlainObject(value)) {
                issues.push(issue(path, "type", {type: "object"}));
                return;
            }
            issues.push(...ownIssues(shallow(node.schema), value, path, OBJECT_CODES));
            const known = new Set<string>();
            for (const child of node.children) {
                const key = String(child.path[child.path.length - 1]);
                known.add(key);
                const childValue = value[key];
                if (childValue === undefined) {
                    const secretSet = child.writeOnly && context.meta[toPointer(child.path)]?.secret === "set";
                    if (child.required && !secretSet) issues.push(issue(child.path, "required"));
                    continue;
                }
                walk(child, childValue, context);
            }
            const required = Array.isArray(node.schema.required) ? node.schema.required.filter((key): key is string => typeof key === "string") : [];
            for (const key of required) if (!known.has(key) && value[key] === undefined) issues.push(issue([...path, key], "required"));
            if (node.schema.additionalProperties === false) {
                for (const key of Object.keys(value)) if (!known.has(key)) issues.push(issue(path, "additional-property", {key}));
            }
            return;
        }
        case "choice":
            if (node.choices.length > 0 && !node.choices.some((choice) => choice.value === value)) issues.push(issue(path, "not-in-choices", {value: value as ChoiceValue}));
            issues.push(...ownIssues(node.schema, value, path, node.choices.length > 0 ? CHOICE_CODES : new Set()));
            return;
        case "multi": {
            if (!Array.isArray(value)) {
                issues.push(issue(path, "type", {type: "array"}));
                return;
            }
            issues.push(...ownIssues(shallow(node.schema), value, path, LIST_CODES));
            value.forEach((entry, index) => {
                if (node.choices.length > 0 && !node.choices.some((choice) => choice.value === entry)) issues.push(issue([...path, index], "not-in-choices", {value: entry as ChoiceValue}));
            });
            return;
        }
        case "string-list":
        case "object-list": {
            if (!Array.isArray(value)) {
                issues.push(issue(path, "type", {type: "array"}));
                return;
            }
            issues.push(...ownIssues(shallow(node.schema), value, path, LIST_CODES));
            value.forEach((entry, index) => {
                const item = itemNode(node, index);
                if (item !== undefined) walk(item, entry, context);
            });
            return;
        }
        default:
            issues.push(...ownIssues(node.schema, value, path, new Set()));
    }
}

/** 根自己是密钥、且已设置时不报缺值。 */
function rootSecretSet(model: FormModel, meta: FormMeta): boolean {
    return model.root.writeOnly && meta[""]?.secret === "set";
}

export function validateForm(model: FormModel, value: unknown, options: {readonly meta?: FormMeta} = {}): FormIssue[] {
    const meta = options.meta ?? {};
    if (value === undefined) return rootSecretSet(model, meta) ? [] : [issue([], "required")];
    const context: WalkContext = {meta, issues: [], jsonFields: []};
    walk(model.root, value, context);
    context.issues.push(...leftovers(model, value, context));
    return context.issues;
}

/**
 * 整值检查里字段树没有报到的错误：归到包含它的 JSON 字段上（同一字段同一个码只报一次），归不到的记在根上。必填与
 * 额外属性由字段树处理（字段树知道哪些是已设置的密钥），这里不再报。
 */
function leftovers(model: FormModel, value: unknown, context: WalkContext): FormIssue[] {
    const result = errorsOf(model.schema, value);
    // 整值求不了值：字段树已经在出错的字段上报了 schema-error 时不在根上再报一次。
    if ("failed" in result) return context.issues.some((entry) => entry.code === "schema-error") ? [] : [failure([], result.failed)];
    // 字段树已经报过的：按“TypeBox 的路径写法 + 码”记下，同一处错误不报两次。
    const known = new Set(context.issues.map((entry) => `${rawPointer(entry.path)}|${entry.code}`));
    const added: FormIssue[] = [];
    for (const error of result.errors) {
        if (/\/anyOf\/\d+/u.test(error.schemaPath)) continue;
        const code = CODES[error.keyword] ?? error.keyword;
        if (code === "required" || code === "additional-property") continue;
        if (known.has(`${error.instancePath}|${code}`)) continue;
        const owners = context.jsonFields.filter((field) => error.instancePath === field.raw || error.instancePath.startsWith(`${field.raw}/`));
        const path = owners.length === 1 ? owners[0]!.path : [];
        const key = `${rawPointer(path)}|${code}`;
        if (known.has(key)) continue;
        known.add(key);
        added.push(issue(path, code, {...(error.params as Record<string, unknown>), at: error.instancePath}));
    }
    return added;
}
