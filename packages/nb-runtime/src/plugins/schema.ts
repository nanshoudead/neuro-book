/**
 * 贡献点声明与远程合同共用的 schema 工具：按 schema 核对一个值，以及判断一份 schema 能不能原样进插件清单。
 *
 * 第三方插件的贡献点与远程合同经清单登记（docs/specs/runtime/plugin-manifest.md），清单是 JSON：函数与 TypeBox 自己的
 * 非枚举标记（`~refine`、`~codec`）序列化时会静默丢掉，插件在自己那份 TypeBox 上注册的 format 内核也不认识。这些写法在
 * 内置插件里照常生效，到了第三方插件就悄悄变宽，所以构建与读清单时都按“纯 JSON Schema”拦下。
 */

import type {TSchema} from "typebox";
import {Value} from "typebox/value";

/** JSON Schema 2020-12 的标准 format；TypeBox 内置的校验覆盖这些。 */
const STANDARD_FORMATS: ReadonlySet<string> = new Set([
    "date", "date-time", "duration", "email", "hostname", "idn-email", "idn-hostname", "ipv4", "ipv6", "iri", "iri-reference",
    "json-pointer", "regex", "relative-json-pointer", "time", "uri", "uri-reference", "uri-template", "uuid",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON Schema 的 `type` 取值。 */
const JSON_TYPES: ReadonlySet<string> = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

/**
 * 按 schema 核对一个值：通过为 null，否则给出第一条问题。schema 本身写坏（例如 `pattern` 不是合法正则）时 TypeBox 会
 * 抛出，这里也报成问题：调用方把它当作这个值不合格，而不是让异常沿调用链冒出去。
 */
export function schemaProblem(schema: TSchema, value: unknown): string | null {
    try {
        if (Value.Check(schema, value)) return null;
        const first = Value.Errors(schema, value)[0];
        return first === undefined ? "不符合声明的结构" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`;
    } catch (error) {
        return `声明的结构无法使用：${error instanceof Error ? error.message : String(error)}`;
    }
}

/** 值是一份 schema 的关键字。 */
const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
    "additionalItems", "additionalProperties", "contains", "contentSchema", "else", "if", "items", "not", "propertyNames", "then",
    "unevaluatedItems", "unevaluatedProperties",
]);
/** 值是 schema 数组的关键字（`items` 的旧写法也是数组，按 `SCHEMA_KEYWORDS` 里的数组处理）。 */
const SCHEMA_LIST_KEYWORDS: ReadonlySet<string> = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
/** 值是“名字到 schema”映射的关键字：映射本身不是 schema，它的每个值才是。 */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set(["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"]);

/** 按 JSON Pointer（`#/$defs/A`）在根 schema 里取值；取不到为 undefined。 */
function resolvePointer(root: unknown, pointer: string): unknown {
    if (pointer === "#") return root;
    if (!pointer.startsWith("#/")) return undefined;
    let node = root;
    for (const raw of pointer.slice(2).split("/")) {
        const key = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
        if (typeof node !== "object" || node === null || !Object.hasOwn(node, key)) return undefined;
        node = (node as Record<string, unknown>)[key];
    }
    return node;
}

/**
 * 一份 schema 不能原样放进清单的地方，按出现顺序列出；空数组表示可以。`path` 是 schema 内部的路径（`properties.name`），
 * 根为空字符串。只看写法，不判断两份 schema 是否等价。
 *
 * 按关键字的语义走：`properties` 这类映射的值、`items` 这类关键字的值才是 schema；`const`、`enum`、`default`、`examples`
 * 与不认识的关键字是数据，只查有没有函数（数据里的 `type`、`format` 不是 schema 的关键字，属性名叫 `type` 的对象很常见）。
 * `$ref` 只能指向同一份 schema 里的位置或 `$id`：宿主不为外部 URI 装载引用，解析不到的引用会让每个值都校验不通过。
 */
export function portabilityProblems(schema: unknown): ReadonlyArray<{readonly path: string; readonly message: string}> {
    const problems: Array<{path: string; message: string}> = [];
    const at = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
    const ids = new Set<string>();
    const refs: Array<{path: string; ref: string}> = [];
    const visitData = (node: unknown, path: string): void => {
        if (typeof node === "function") {
            problems.push({path, message: "含有函数"});
            return;
        }
        if (typeof node !== "object" || node === null) return;
        for (const [key, child] of Object.entries(node)) visitData(child, at(path, key));
    };
    const visitSchema = (node: unknown, path: string): void => {
        if (typeof node === "function") {
            problems.push({path, message: "含有函数"});
            return;
        }
        // 布尔值是合法的 schema（true 什么都接受，false 什么都拒绝）。
        if (typeof node === "boolean") return;
        if (typeof node !== "object" || node === null || Array.isArray(node)) {
            problems.push({path, message: "不是 JSON Schema（应为对象或布尔值）"});
            return;
        }
        // `~refine`、`~codec` 是不可枚举的属性，`Object.keys` 与 `JSON.stringify` 都看不见，所以单独查。
        if (Object.hasOwn(node, "~refine")) problems.push({path, message: "用了 Refine：自定义校验函数进不了清单"});
        if (Object.hasOwn(node, "~codec")) problems.push({path, message: "用了 Codec：编解码函数进不了清单"});
        const record = node as Record<string, unknown>;
        if (typeof record.format === "string" && !STANDARD_FORMATS.has(record.format)) {
            problems.push({path, message: `format ${record.format} 不是 JSON Schema 的标准 format，宿主不认识`});
        }
        // TypeBox 到校验时才编译正则，坏的正则在那时抛出；而那条分支只在值的类型对上时才走到，试一个值发现不了。
        const patterns = [...(typeof record.pattern === "string" ? [record.pattern] : []), ...(isPlainObject(record.patternProperties) ? Object.keys(record.patternProperties) : [])];
        for (const pattern of patterns) {
            try {
                new RegExp(pattern, "u");
            } catch {
                problems.push({path, message: `不是合法的正则：${pattern}`});
            }
        }
        const types = Array.isArray(record.type) ? record.type : record.type === undefined ? [] : [record.type];
        for (const type of types) {
            if (typeof type !== "string" || !JSON_TYPES.has(type)) problems.push({path, message: `type 不是 JSON Schema 的类型：${String(type)}`});
        }
        if (typeof record.$id === "string") ids.add(record.$id);
        if (record.$ref !== undefined) {
            if (typeof record.$ref === "string") refs.push({path, ref: record.$ref});
            else problems.push({path, message: "$ref 不是字符串"});
        }
        for (const [key, child] of Object.entries(record)) {
            const here = at(path, key);
            if (SCHEMA_MAP_KEYWORDS.has(key) && isPlainObject(child)) {
                for (const [name, value] of Object.entries(child)) visitSchema(value, at(here, name));
            } else if (SCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(child)) {
                child.forEach((item, index) => visitSchema(item, at(here, String(index))));
            } else if (SCHEMA_KEYWORDS.has(key)) {
                if (Array.isArray(child)) child.forEach((item, index) => visitSchema(item, at(here, String(index))));
                else visitSchema(child, here);
            } else {
                visitData(child, here);
            }
        }
    };
    visitSchema(schema, "");
    for (const {path, ref} of refs) {
        if (!ids.has(ref) && resolvePointer(schema, ref) === undefined) problems.push({path, message: `$ref ${ref} 在这份 schema 里解析不到（只能引用同一份 schema 里的位置或 $id）`});
    }
    // 写法都合法、内容仍可能让校验抛出（例如坏的正则）：用一个值试一次，抛出就算不能用。
    if (problems.length === 0 && typeof schema === "object" && schema !== null) {
        try {
            Value.Check(schema as TSchema, undefined);
        } catch (error) {
            problems.push({path: "", message: `校验时出错：${error instanceof Error ? error.message : String(error)}`});
        }
    }
    return problems;
}
