/**
 * 校验与问题（docs/specs/ui/forms.md 输出 7–10）。
 *
 * 不把 TypeBox 的错误直接换成问题：它的必填错误报在父对象上、缺两个字段只有一条，字面量联合一个值报三条，路径也不
 * 转义。所以沿字段树逐个字段校验：必填由这里按父对象的 `required` 展开到缺的那个字段；字面量联合只报一条
 * `not-in-choices`；叶子字段的其余约束用 TypeBox 对它自己的子 schema 求出，只取作用在这个值本身的那几条。最后对整值
 * 检查一次，归不到字段的错误记在根上。任何 TypeBox 调用的异常（例如写错的正则）记为 `schema-error`，不抛出。
 */

import {Value} from "typebox/value";

import type {ChoiceValue, FieldNode, FormModel, JsonSchema} from "./model";
import {itemNode} from "./model";
import {toPointer} from "./path";
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

/** TypeBox 的关键字到问题码。 */
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
    const: "not-in-choices",
    enum: "not-in-choices",
    anyOf: "not-in-choices",
    additionalProperties: "additional-property",
};

function schemaIssue(path: FieldPath, code: string, params: Readonly<Record<string, unknown>> = {}): FormIssue {
    return {path, code, params, severity: "error", source: "schema"};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 一个值在它自己的 schema 下、作用在值本身的约束问题（不下钻到成员：成员由字段树各自校验）。`Value.Errors` 的异常
 * 记为 `schema-error`。
 */
function ownErrors(schema: JsonSchema, value: unknown, path: FieldPath): FormIssue[] {
    let errors;
    try {
        errors = Value.Errors(schema, value);
    } catch (error) {
        return [schemaIssue(path, "schema-error", {detail: error instanceof Error ? error.message : String(error)})];
    }
    const issues: FormIssue[] = [];
    const seen = new Set<string>();
    for (const error of errors) {
        if (error.instancePath !== "") continue;
        const code = CODES[error.keyword] ?? error.keyword;
        if (seen.has(code)) continue;
        seen.add(code);
        issues.push(schemaIssue(path, code, error.params as Record<string, unknown>));
    }
    return issues;
}

function inChoices(node: FieldNode, value: unknown): boolean {
    return node.choices.some((choice) => choice.value === value);
}

/** 字面量的选项判断按值与类型都相同；`choices` 为空（动态选项）时只核对 schema。 */
function checkChoice(node: FieldNode, value: unknown, path: FieldPath): FormIssue[] {
    if (node.choices.length > 0) return inChoices(node, value) ? [] : [schemaIssue(path, "not-in-choices", {value: value as ChoiceValue})];
    return ownErrors(node.schema, value, path);
}

function walk(node: FieldNode, value: unknown, meta: FormMeta, into: FormIssue[]): void {
    const {path} = node;
    if (value === undefined) return;
    if (value === null) {
        if (!node.nullable) into.push(schemaIssue(path, "type", {type: node.schema.type ?? "value"}));
        return;
    }
    switch (node.kind) {
        case "object": {
            if (!isPlainObject(value)) {
                into.push(schemaIssue(path, "type", {type: "object"}));
                return;
            }
            const known = new Set<string>();
            for (const child of node.children) {
                const key = String(child.path[child.path.length - 1]);
                known.add(key);
                const childValue = value[key];
                if (childValue === undefined) {
                    const secretSet = child.writeOnly && meta[toPointer(child.path)]?.secret === "set";
                    if (child.required && !secretSet) into.push(schemaIssue(child.path, "required"));
                    continue;
                }
                walk(child, childValue, meta, into);
            }
            if (node.schema.additionalProperties === false) {
                for (const key of Object.keys(value)) if (!known.has(key)) into.push(schemaIssue(path, "additional-property", {key}));
            }
            return;
        }
        case "choice":
            into.push(...checkChoice(node, value, path));
            return;
        case "multi": {
            if (!Array.isArray(value)) {
                into.push(schemaIssue(path, "type", {type: "array"}));
                return;
            }
            into.push(...ownErrors(node.schema, value, path).filter((issue) => issue.code !== "not-in-choices"));
            value.forEach((entry, index) => {
                if (node.choices.length > 0 && !inChoices(node, entry)) into.push(schemaIssue([...path, index], "not-in-choices", {value: entry as ChoiceValue}));
            });
            return;
        }
        case "string-list":
        case "object-list": {
            if (!Array.isArray(value)) {
                into.push(schemaIssue(path, "type", {type: "array"}));
                return;
            }
            into.push(...ownErrors(node.schema, value, path).filter((issue) => ["min-items", "max-items", "unique-items"].includes(issue.code)));
            value.forEach((entry, index) => {
                const item = itemNode(node, index);
                if (item !== undefined) walk(item, entry, meta, into);
            });
            return;
        }
        case "json": {
            // JSON 编辑的字段不再分字段：它自己的全部错误都标在它上面，同一个码只报一次。
            let errors;
            try {
                errors = Value.Errors(node.schema, value);
            } catch (error) {
                into.push(schemaIssue(path, "schema-error", {detail: error instanceof Error ? error.message : String(error)}));
                return;
            }
            const seen = new Set<string>();
            for (const error of errors) {
                const code = CODES[error.keyword] ?? error.keyword;
                const key = `${code}:${error.instancePath}`;
                if (seen.has(key)) continue;
                seen.add(key);
                into.push(schemaIssue(path, code, {...(error.params as Record<string, unknown>), at: error.instancePath}));
            }
            return;
        }
        default:
            into.push(...ownErrors(node.schema, value, path));
    }
}

/**
 * 校验整个值。根缺值且根是必填（总是）时报根上的 `required`。字段树之外的错误（例如 `$ref` 里的约束只在整值检查时
 * 才看得到）在字段都没有问题时记在根上，免得同一处错误报两次。
 */
export function validateForm(model: FormModel, value: unknown, options: {readonly meta?: FormMeta} = {}): FormIssue[] {
    const meta = options.meta ?? {};
    const issues: FormIssue[] = [];
    if (value === undefined) return [schemaIssue([], "required")];
    walk(model.root, value, meta, issues);
    if (issues.length === 0) {
        try {
            if (!Value.Check(model.schema, value)) issues.push(...rootLeftovers(model, value, meta));
        } catch (error) {
            issues.push(schemaIssue([], "schema-error", {detail: error instanceof Error ? error.message : String(error)}));
        }
    }
    return issues;
}

/**
 * 字段树都通过、整值却不通过：只可能是字段树没有表达的约束，或者是密钥“已设置”时跳过的必填。后者不是错误。
 */
function rootLeftovers(model: FormModel, value: unknown, meta: FormMeta): FormIssue[] {
    let errors;
    try {
        errors = Value.Errors(model.schema, value);
    } catch (error) {
        return [schemaIssue([], "schema-error", {detail: error instanceof Error ? error.message : String(error)})];
    }
    const secretsSet = new Set(Object.entries(meta).filter(([, state]) => state.secret === "set").map(([pointer]) => pointer));
    const issues: FormIssue[] = [];
    for (const error of errors) {
        if (error.keyword === "required") {
            const missing = (error.params as {requiredProperties?: ReadonlyArray<string>}).requiredProperties ?? [];
            if (missing.every((key) => secretsSet.has(`${error.instancePath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`))) continue;
        }
        issues.push(schemaIssue([], CODES[error.keyword] ?? error.keyword, {...(error.params as Record<string, unknown>), at: error.instancePath}));
        break;
    }
    return issues;
}
