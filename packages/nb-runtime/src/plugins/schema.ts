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

/**
 * 一份 schema 不能原样放进清单的地方，按出现顺序列出；空数组表示可以。`path` 是 schema 内部的路径（`properties.name`），
 * 根为空字符串。只看写法，不判断两份 schema 是否等价。
 */
export function portabilityProblems(schema: unknown): ReadonlyArray<{readonly path: string; readonly message: string}> {
    const problems: Array<{path: string; message: string}> = [];
    const visit = (node: unknown, path: string): void => {
        if (typeof node === "function") {
            problems.push({path, message: "含有函数"});
            return;
        }
        if (typeof node !== "object" || node === null) return;
        if (Array.isArray(node)) {
            node.forEach((item, index) => visit(item, path === "" ? String(index) : `${path}.${String(index)}`));
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
        for (const [key, child] of Object.entries(record)) {
            visit(child, path === "" ? key : `${path}.${key}`);
        }
    };
    visit(schema, "");
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
