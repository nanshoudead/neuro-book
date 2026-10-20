/**
 * 按 JSON Schema 的结构遍历一份 schema：只在 schema 的位置上识别关键字，`properties` 这类“名字到 schema”的表只
 * 遍历它的值，`const`、`enum`、`default`、`examples` 是数据，不当 schema 解释。描述检查（Agent 策略、条件 schema
 * 的正则）用它，免得把名叫 `pattern` 的字段当成正则，也免得漏掉藏在 `items` 数组、`contains` 这类位置的关键字。
 *
 * 遍历带已访问集合与深度上限，自引用的 JS 对象不会让它无限递归。
 */

import {isRecord} from "./guards";

/** 值是一个 schema 的关键字。 */
const SCHEMA_KEYWORDS = ["items", "additionalProperties", "contains", "propertyNames", "not", "if", "then", "else", "additionalItems", "unevaluatedItems", "unevaluatedProperties"] as const;
/** 值是 schema 数组的关键字。 */
const SCHEMA_ARRAY_KEYWORDS = ["anyOf", "allOf", "oneOf", "prefixItems", "items"] as const;
/** 值是“名字到 schema”的表的关键字。 */
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"] as const;

export interface SchemaVisit {
    readonly node: Readonly<Record<string, unknown>>;
    /** 从根到这里经过的 schema 层数（每进一个子 schema 加一）。 */
    readonly depth: number;
}

/**
 * 依次访问每个 schema 节点；`x-form.visibleWhen.schema` 也是 schema。超过 `maxDepth` 时不再下钻，并以 `truncated`
 * 告诉调用方。
 */
export function walkSchema(root: unknown, visit: (entry: SchemaVisit) => void, maxDepth = 64): {readonly truncated: boolean} {
    const seen = new Set<object>();
    let truncated = false;
    const go = (value: unknown, depth: number): void => {
        if (!isRecord(value) || seen.has(value)) return;
        if (depth > maxDepth) {
            truncated = true;
            return;
        }
        seen.add(value);
        visit({node: value, depth});
        for (const keyword of SCHEMA_KEYWORDS) if (isRecord(value[keyword])) go(value[keyword], depth + 1);
        for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
            const members = value[keyword];
            if (Array.isArray(members)) for (const member of members) go(member, depth + 1);
        }
        for (const keyword of SCHEMA_MAP_KEYWORDS) {
            const table = value[keyword];
            if (isRecord(table)) for (const member of Object.values(table)) go(member, depth + 1);
        }
        const hints = value["x-form"];
        if (isRecord(hints) && isRecord(hints.visibleWhen) && isRecord(hints.visibleWhen.schema)) go(hints.visibleWhen.schema, depth + 1);
    };
    go(root, 0);
    return {truncated};
}

/** schema 里写错的正则（`pattern` 与 `patternProperties` 的键）；没有时为空。 */
export function badPatterns(schema: unknown): string[] {
    const bad: string[] = [];
    const tryPattern = (pattern: unknown) => {
        if (typeof pattern !== "string") {
            bad.push(String(pattern));
            return;
        }
        try {
            new RegExp(pattern, "u");
        } catch {
            bad.push(pattern);
        }
    };
    walkSchema(schema, ({node}) => {
        if (Object.hasOwn(node, "pattern")) tryPattern(node.pattern);
        if (isRecord(node.patternProperties)) for (const key of Object.keys(node.patternProperties)) tryPattern(key);
    });
    return bad;
}
