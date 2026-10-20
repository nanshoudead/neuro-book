/**
 * 描述检查（docs/specs/ui/forms.md 输出 1、13、23）：一份描述能不能用、哪些部分只能用 JSON 编辑、哪里写错了。
 * 可信作者（插件、设置）的描述按完整写法检查；模型生成的描述（`policy: "agent"`）只接受一个能列举清楚的子集。
 *
 * 检查从不抛异常：描述来自模型时，坏 schema 本身就是要报告的结果。`x-form` 在这里按原始 JSON 完整校验形状；
 * `resolveForm` 读提示时只留合格的部分，所以不能拿解析后的结果代替这里的检查。
 */

import {BUILTIN_WIDGETS, findNode, resolveForm} from "./model";
import type {FieldKind, FieldNode, FormLayout} from "./model";
import {toPointer} from "./path";
import {badPatterns, walkSchema} from "./schema-walk";
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

/**
 * 模型生成的描述的上限（输出 23）。`objectNesting`：根对象之下还能有几层对象（对象列表的元素也算一层）；
 * `schemaDepth`：schema 嵌套的层数，`anyOf` 这类组合器的每一层都算；节点、字节与文字长度把布局一起算上。
 */
export const AGENT_LIMITS = {nodes: 100, unionWidth: 50, objectNesting: 1, schemaDepth: 8, bytes: 32 * 1024, textLength: 2000} as const;
const AGENT_FORMATS = new Set(["uri", "email"]);
const AGENT_FORBIDDEN_KEYWORDS = ["pattern", "patternProperties", "$ref", "$defs", "definitions", "writeOnly", "$dynamicRef", "dependentSchemas", "if", "then", "else", "not", "allOf", "oneOf", "contains", "propertyNames", "prefixItems"] as const;

const TEXT_HINTS = ["label", "help", "placeholder", "unit"] as const;
const STRING_HINTS = ["widget", "options", "itemLabel"] as const;
const HINT_KEYS = new Set<string>([...TEXT_HINTS, ...STRING_HINTS, "choices", "searchable", "visibleWhen", "recommend", "rows"]);

/** 每种种类能写的内建控件；`json` 对任何种类都能写。 */
const WIDGETS_FOR_KIND: Readonly<Record<FieldKind, ReadonlySet<string>>> = {
    "boolean": new Set(["confirm"]),
    "choice": new Set(["radio", "select", "search-select"]),
    "multi": new Set(["checkboxes"]),
    "number": new Set(),
    "text": new Set(["multiline", "secret", "select", "search-select"]),
    "string-list": new Set(["list"]),
    "object": new Set(),
    "object-list": new Set(["list", "master-detail"]),
    "json": new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChoiceValue(value: unknown): boolean {
    return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function problem(path: string, code: string, params: Readonly<Record<string, unknown>> = {}, severity: "error" | "warning" = "error"): DescriptionProblem {
    return {path, code, params, severity};
}

/** `x-form` 的原始形状：每个键的类型，数组逐项。 */
function checkHintShapes(at: string, raw: unknown, into: DescriptionProblem[]): void {
    if (raw === undefined) return;
    if (!isRecord(raw)) {
        into.push(problem(at, "hints-not-object"));
        return;
    }
    for (const key of Object.keys(raw)) if (!HINT_KEYS.has(key)) into.push(problem(at, "unknown-hint", {key}));
    for (const key of TEXT_HINTS) if (raw[key] !== undefined && !isFormText(raw[key])) into.push(problem(at, "bad-hint", {key}));
    for (const key of STRING_HINTS) if (raw[key] !== undefined && (typeof raw[key] !== "string" || raw[key] === "")) into.push(problem(at, "bad-hint", {key}));
    if (raw.searchable !== undefined && typeof raw.searchable !== "boolean") into.push(problem(at, "bad-hint", {key: "searchable"}));
    if (raw.rows !== undefined && !(typeof raw.rows === "number" && Number.isInteger(raw.rows) && raw.rows > 0)) into.push(problem(at, "bad-hint", {key: "rows"}));
    if (raw.choices !== undefined) {
        if (!Array.isArray(raw.choices)) into.push(problem(at, "bad-hint", {key: "choices"}));
        else raw.choices.forEach((choice, index) => {
            const ok = isRecord(choice) && isChoiceValue(choice.value) && isFormText(choice.label)
                && (choice.description === undefined || isFormText(choice.description)) && (choice.disabled === undefined || typeof choice.disabled === "boolean");
            if (!ok) into.push(problem(at, "bad-hint", {key: "choices", index}));
        });
    }
    if (raw.recommend !== undefined) {
        if (!Array.isArray(raw.recommend)) into.push(problem(at, "bad-hint", {key: "recommend"}));
        else raw.recommend.forEach((value, index) => {
            if (!isChoiceValue(value)) into.push(problem(at, "bad-hint", {key: "recommend", index}));
        });
    }
    if (raw.visibleWhen !== undefined) {
        const condition = raw.visibleWhen;
        if (!isRecord(condition) || typeof condition.field !== "string" || condition.field === "" || !isRecord(condition.schema)) into.push(problem(at, "bad-hint", {key: "visibleWhen"}));
    }
}

/** 字段自己这一层写错的正则（对象与列表的成员由成员各自检查）。 */
function ownBadPatterns(node: FieldNode): string[] {
    const own: Record<string, unknown> = {};
    if (Object.hasOwn(node.schema, "pattern")) own.pattern = node.schema.pattern;
    if (node.kind === "json") return badPatterns(node.schema);
    return badPatterns(own);
}

/** 一个字段的提示与 schema 的配合。 */
function checkNode(node: FieldNode, root: FieldNode, policy: "trusted" | "agent", into: DescriptionProblem[]): void {
    const at = toPointer(node.path);
    checkHintShapes(at, node.schema["x-form"], into);
    const widget = node.hints.widget;
    if (widget !== undefined) {
        const builtin = (BUILTIN_WIDGETS as readonly string[]).includes(widget) || widget === "list";
        if (!builtin) {
            if (policy === "agent") into.push(problem(at, "custom-widget-not-allowed", {widget}));
        } else if (widget !== "json" && !WIDGETS_FOR_KIND[node.kind].has(widget)) {
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
        if (node.required) into.push(problem(at, "conditional-required"));
        if (condition.field.startsWith("/") && findNode(root, condition.field) === undefined) into.push(problem(at, "visible-when-unknown-field", {field: condition.field}));
        for (const pattern of badPatterns(condition.schema)) into.push(problem(at, "visible-when-bad-pattern", {pattern}));
    }
    for (const pattern of ownBadPatterns(node)) into.push(problem(at, "bad-pattern", {pattern}));
    if (node.kind === "object-list" && node.hints.itemLabel !== undefined) {
        const names = node.item?.children.map((child) => String(child.path[child.path.length - 1])) ?? [];
        if (!names.includes(node.hints.itemLabel)) into.push(problem(at, "item-label-unknown", {field: node.hints.itemLabel}));
    }
    if (node.writeOnly && node.kind !== "text") into.push(problem(at, "write-only-not-text"));
    if (node.kind === "json") into.push(problem(at, "json-field", {}, "warning"));
}

/** `nesting`：这个字段在根对象之下的对象层数（根对象为 0）。 */
function checkTree(node: FieldNode, root: FieldNode, policy: "trusted" | "agent", into: DescriptionProblem[], nesting: number): void {
    checkNode(node, root, policy, into);
    if (policy === "agent" && nesting > AGENT_LIMITS.objectNesting) into.push(problem(toPointer(node.path), "too-deep", {limit: AGENT_LIMITS.objectNesting}));
    const names = new Set(node.children.map((child) => String(child.path[child.path.length - 1])));
    for (const child of node.children) {
        const condition = child.hints.visibleWhen;
        if (condition !== undefined && !condition.field.startsWith("/") && !names.has(condition.field)) {
            into.push(problem(toPointer(child.path), "visible-when-unknown-field", {field: condition.field}));
        }
        checkTree(child, root, policy, into, child.kind === "object" ? nesting + 1 : nesting);
    }
    if (node.item !== undefined) checkTree(node.item, root, policy, into, node.item.kind === "object" ? nesting + 1 : nesting);
}

/** 布局只排根上的字段；不存在、重复、不在根上的字段报错。 */
function checkLayout(layout: unknown, root: FieldNode, seen: Set<string>, into: DescriptionProblem[]): void {
    if (!isRecord(layout)) {
        into.push(problem("", "layout-bad-node"));
        return;
    }
    if (layout.type === "field") {
        const path = layout.path;
        if (typeof path !== "string") into.push(problem("", "layout-bad-node"));
        else if (findNode(root, path) === undefined) into.push(problem(path, "layout-unknown-field"));
        else if (root.kind === "object" && path.split("/").length !== 2) into.push(problem(path, "layout-nested-field"));
        else if (seen.has(path)) into.push(problem(path, "layout-duplicate-field"));
        else seen.add(path);
        return;
    }
    if (layout.type !== "column" && layout.type !== "row" && layout.type !== "group") {
        into.push(problem("", "layout-bad-node"));
        return;
    }
    if (layout.type === "group" && !isFormText(layout.label)) into.push(problem("", "layout-bad-label"));
    if (!Array.isArray(layout.items)) {
        into.push(problem("", "layout-bad-node"));
        return;
    }
    for (const item of layout.items) checkLayout(item, root, seen, into);
}

/** 模型生成的描述：在 schema 与布局的原始 JSON 上数节点、量深度与宽度、找禁用的关键字（条件里的 schema 也算）。 */
function checkAgentShape(schema: unknown, layout: unknown, into: DescriptionProblem[]): void {
    let bytes: number;
    try {
        bytes = new TextEncoder().encode(JSON.stringify({schema, layout: layout ?? null})).length;
    } catch {
        into.push(problem("", "not-json"));
        return;
    }
    if (bytes > AGENT_LIMITS.bytes) into.push(problem("", "too-large", {bytes, limit: AGENT_LIMITS.bytes}));
    const longText = (value: unknown, seen = new Set<object>()): boolean => {
        if (typeof value === "string") return value.length > AGENT_LIMITS.textLength;
        if (typeof value !== "object" || value === null || seen.has(value)) return false;
        seen.add(value);
        return Object.values(value).some((entry) => longText(entry, seen));
    };
    if (longText(schema) || longText(layout)) into.push(problem("", "text-too-long", {limit: AGENT_LIMITS.textLength}));
    let nodes = 0;
    const {truncated} = walkSchema(schema, ({node}) => {
        nodes += 1;
        for (const keyword of AGENT_FORBIDDEN_KEYWORDS) if (Object.hasOwn(node, keyword)) into.push(problem("", "keyword-not-allowed", {keyword}));
        if (typeof node.format === "string" && !AGENT_FORMATS.has(node.format)) into.push(problem("", "format-not-allowed", {format: node.format}));
        for (const union of ["anyOf", "enum"]) {
            const members = node[union];
            if (Array.isArray(members) && members.length > AGENT_LIMITS.unionWidth) into.push(problem("", "union-too-wide", {width: members.length, limit: AGENT_LIMITS.unionWidth}));
        }
    }, AGENT_LIMITS.schemaDepth);
    if (truncated) into.push(problem("", "too-deep", {limit: AGENT_LIMITS.schemaDepth}));
    const layoutNodes = (value: unknown, depth: number): number => {
        if (!isRecord(value) || depth > AGENT_LIMITS.schemaDepth) return 0;
        const items = Array.isArray(value.items) ? value.items : [];
        return 1 + items.reduce((sum: number, entry: unknown) => sum + layoutNodes(entry, depth + 1), 0);
    };
    nodes += layoutNodes(layout, 0);
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
        if (policy === "agent") checkAgentShape(schema, options.layout, problems);
        const model = resolveForm(schema, options.layout === undefined ? {} : {layout: options.layout});
        if (policy === "agent" && model.root.kind !== "object") problems.push(problem("", "root-not-object"));
        checkTree(model.root, model.root, policy, problems, 0);
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
