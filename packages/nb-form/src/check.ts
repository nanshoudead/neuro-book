/**
 * 描述检查（docs/specs/ui/forms.md 输出 1、13、23）：一份描述能不能用、哪些部分只能用 JSON 编辑、哪里写错了。
 * 可信作者（插件、设置）的描述按完整写法检查；模型生成的描述（`policy: "agent"`）只接受一个能列举清楚的子集。
 *
 * 检查从不抛异常：描述来自模型时，坏 schema 本身就是要报告的结果。
 */

import {Value} from "typebox/value";

import {BUILTIN_WIDGETS, findNode, kindOf, resolveForm} from "./model";
import type {FieldNode, FormLayout, JsonSchema} from "./model";
import {toPointer} from "./path";
import {isFormText} from "./text";

export interface DescriptionProblem {
    /** 出问题的字段（JSON Pointer）；与字段无关时为空串。 */
    readonly path: string;
    readonly code: string;
    readonly params: Readonly<Record<string, unknown>>;
    /** `warning` 不妨碍使用（例如布局漏写的字段会补在末尾）。 */
    readonly severity: "error" | "warning";
}

export interface DescriptionCheck {
    /** `structured`：全部字段都能结构化编辑；`json`：有字段要用 JSON 编辑；`invalid`：有 error 级的问题。 */
    readonly status: "structured" | "json" | "invalid";
    readonly problems: ReadonlyArray<DescriptionProblem>;
}

/** 模型生成的描述的上限（输出 23）。 */
export const AGENT_LIMITS = {nodes: 100, unionWidth: 50, depth: 3, bytes: 32 * 1024, textLength: 2000} as const;
const AGENT_FORMATS = new Set(["uri", "email"]);
const AGENT_FORBIDDEN_KEYWORDS = ["pattern", "patternProperties", "$ref", "$defs", "definitions", "writeOnly", "$dynamicRef", "dependentSchemas", "if", "then", "else", "not", "allOf", "oneOf"] as const;
const HINT_KEYS = new Set(["label", "help", "placeholder", "unit", "widget", "choices", "options", "searchable", "visibleWhen", "itemLabel", "recommend", "rows"]);

const WIDGETS_FOR_KIND: Readonly<Record<string, ReadonlySet<string>>> = {
    "boolean": new Set(["confirm"]),
    "choice": new Set(["radio", "select", "search-select"]),
    "multi": new Set(["checkboxes"]),
    "text": new Set(["multiline", "secret", "select", "search-select"]),
    "string-list": new Set(["list"]),
    "object-list": new Set(["list", "master-detail"]),
    "json": new Set(["json"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function problem(path: string, code: string, params: Readonly<Record<string, unknown>> = {}, severity: "error" | "warning" = "error"): DescriptionProblem {
    return {path, code, params, severity};
}

/** 一个字段的 `x-form` 与 schema 的配合。 */
function checkNode(node: FieldNode, policy: "trusted" | "agent", into: DescriptionProblem[]): void {
    const at = toPointer(node.path);
    const raw = node.schema["x-form"];
    if (raw !== undefined) {
        if (!isRecord(raw)) into.push(problem(at, "hints-not-object"));
        else {
            for (const key of Object.keys(raw)) if (!HINT_KEYS.has(key)) into.push(problem(at, "unknown-hint", {key}));
            for (const key of ["label", "help", "placeholder", "unit"]) if (raw[key] !== undefined && !isFormText(raw[key])) into.push(problem(at, "bad-hint", {key}));
        }
    }
    const widget = node.hints.widget;
    if (widget !== undefined) {
        const builtin = (BUILTIN_WIDGETS as readonly string[]).includes(widget) || widget === "list";
        if (!builtin) {
            if (policy === "agent") into.push(problem(at, "custom-widget-not-allowed", {widget}));
        } else if (!(WIDGETS_FOR_KIND[node.kind]?.has(widget) ?? false)) {
            into.push(problem(at, "widget-mismatch", {widget, kind: node.kind}));
        }
        if (policy === "agent" && widget === "secret") into.push(problem(at, "secret-not-allowed"));
    }
    if (node.hints.choices !== undefined && node.kind !== "choice" && node.kind !== "multi") into.push(problem(at, "choices-without-literals"));
    if (node.hints.choices !== undefined && node.choices.length > 0) {
        const values = new Set(node.choices.map((choice) => `${typeof choice.value}:${String(choice.value)}`));
        for (const choice of node.hints.choices) if (!values.has(`${typeof choice.value}:${String(choice.value)}`)) into.push(problem(at, "choice-not-in-schema", {value: choice.value}));
    }
    for (const value of node.hints.recommend ?? []) {
        if (!node.choices.some((choice) => choice.value === value)) into.push(problem(at, "recommend-not-in-choices", {value}));
    }
    const condition = node.hints.visibleWhen;
    if (condition !== undefined) {
        // 兄弟字段存不存在由 checkTree 在父对象上核对。
        if (node.required) into.push(problem(at, "conditional-required"));
        try {
            Value.Check(condition.schema, undefined);
        } catch (error) {
            into.push(problem(at, "visible-when-schema-error", {detail: error instanceof Error ? error.message : String(error)}));
        }
    }
    if (node.kind === "object-list" && node.hints.itemLabel !== undefined) {
        const names = node.item?.children.map((child) => String(child.path[child.path.length - 1])) ?? [];
        if (!names.includes(node.hints.itemLabel)) into.push(problem(at, "item-label-unknown", {field: node.hints.itemLabel}));
    }
    if (node.writeOnly && node.kind !== "text") into.push(problem(at, "write-only-not-text"));
    if (node.kind === "json") into.push(problem(at, "json-field", {}, "warning"));
}

function checkTree(node: FieldNode, policy: "trusted" | "agent", into: DescriptionProblem[]): void {
    checkNode(node, policy, into);
    const names = new Set(node.children.map((child) => String(child.path[child.path.length - 1])));
    for (const child of node.children) {
        const condition = child.hints.visibleWhen;
        if (condition !== undefined && !condition.field.startsWith("/") && !names.has(condition.field)) {
            into.push(problem(toPointer(child.path), "visible-when-unknown-field", {field: condition.field}));
        }
        checkTree(child, policy, into);
    }
    if (node.item !== undefined) checkTree(node.item, policy, into);
}

function checkLayout(layout: FormLayout, root: FieldNode, seen: Set<string>, into: DescriptionProblem[]): void {
    if (layout.type === "field") {
        if (findNode(root, layout.path) === undefined) into.push(problem(layout.path, "layout-unknown-field"));
        else if (seen.has(layout.path)) into.push(problem(layout.path, "layout-duplicate-field"));
        seen.add(layout.path);
        return;
    }
    if (layout.type === "group" && !isFormText(layout.label)) into.push(problem("", "layout-bad-label"));
    for (const item of layout.items) checkLayout(item, root, seen, into);
}

/** 模型生成的描述：在原始 JSON 上数节点、量深度与宽度、找禁用的关键字（条件里的 schema 也算）。 */
function checkAgentShape(schema: unknown, into: DescriptionProblem[]): void {
    let bytes: number;
    try {
        bytes = new TextEncoder().encode(JSON.stringify(schema)).length;
    } catch {
        into.push(problem("", "not-json"));
        return;
    }
    if (bytes > AGENT_LIMITS.bytes) into.push(problem("", "too-large", {bytes, limit: AGENT_LIMITS.bytes}));
    let nodes = 0;
    const visit = (value: unknown, depth: number): void => {
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry, depth);
            return;
        }
        if (!isRecord(value)) {
            if (typeof value === "string" && value.length > AGENT_LIMITS.textLength) into.push(problem("", "text-too-long", {length: value.length, limit: AGENT_LIMITS.textLength}));
            return;
        }
        nodes += 1;
        for (const keyword of AGENT_FORBIDDEN_KEYWORDS) if (Object.hasOwn(value, keyword)) into.push(problem("", "keyword-not-allowed", {keyword}));
        if (typeof value.format === "string" && !AGENT_FORMATS.has(value.format)) into.push(problem("", "format-not-allowed", {format: value.format}));
        for (const union of ["anyOf", "enum"]) {
            const members = value[union];
            if (Array.isArray(members) && members.length > AGENT_LIMITS.unionWidth) into.push(problem("", "union-too-wide", {width: members.length, limit: AGENT_LIMITS.unionWidth}));
        }
        const nested = value.type === "object" || value.type === "array";
        for (const [key, entry] of Object.entries(value)) visit(entry, nested && (key === "properties" || key === "items") ? depth + 1 : depth);
        if (depth > AGENT_LIMITS.depth) into.push(problem("", "too-deep", {limit: AGENT_LIMITS.depth}));
    };
    visit(schema, 0);
    if (nodes > AGENT_LIMITS.nodes) into.push(problem("", "too-many-nodes", {nodes, limit: AGENT_LIMITS.nodes}));
}

function dedupe(problems: DescriptionProblem[]): DescriptionProblem[] {
    const seen = new Set<string>();
    return problems.filter((entry) => {
        const key = `${entry.path}|${entry.code}|${JSON.stringify(entry.params)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function checkDescription(schema: unknown, options: {readonly layout?: FormLayout; readonly policy?: "trusted" | "agent"} = {}): DescriptionCheck {
    const policy = options.policy ?? "trusted";
    const problems: DescriptionProblem[] = [];
    try {
        if (!isRecord(schema)) return {status: "invalid", problems: [problem("", "not-a-schema")]};
        if (policy === "agent") {
            checkAgentShape(schema, problems);
            if (kindOf(schema as JsonSchema) !== "object") problems.push(problem("", "root-not-object"));
        }
        const model = resolveForm(schema as JsonSchema, options.layout === undefined ? {} : {layout: options.layout});
        checkTree(model.root, policy, problems);
        if (options.layout !== undefined) {
            const seen = new Set<string>();
            checkLayout(options.layout, model.root, seen, problems);
            for (const child of model.root.children) {
                const pointer = toPointer(child.path);
                if (!seen.has(pointer)) problems.push(problem(pointer, "layout-missing-field", {}, "warning"));
            }
        }
        if (policy === "agent") {
            const unsupported = problems.filter((entry) => entry.code === "json-field").map((entry) => problem(entry.path, "unsupported-type"));
            problems.push(...unsupported);
        }
    } catch (error) {
        problems.push(problem("", "description-error", {detail: error instanceof Error ? error.message : String(error)}));
    }
    const unique = dedupe(problems);
    const status = unique.some((entry) => entry.severity === "error") ? "invalid" : unique.some((entry) => entry.code === "json-field") ? "json" : "structured";
    return {status, problems: unique};
}
