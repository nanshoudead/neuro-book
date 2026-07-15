import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {Model} from "@earendil-works/pi-ai";

const GEMINI_SCHEMA_ALLOWED_KEYS = new Set([
    "type",
    "format",
    "title",
    "description",
    "nullable",
    "enum",
    "maxItems",
    "minItems",
    "properties",
    "required",
    "minProperties",
    "maxProperties",
    "minLength",
    "maxLength",
    "pattern",
    "example",
    "anyOf",
    "propertyOrdering",
    "default",
    "items",
    "minimum",
    "maximum",
]);

type JsonRecord = Record<string, unknown>;

/**
 * 针对 provider 能见的工具 schema 做兼容裁剪。
 * 执行期仍走原始 validationSchema / parameters 校验，这里只负责避免 provider 因未知 schema 字段拒绝整次请求。
 */
export function sanitizeProviderVisibleToolsForModel(
    model: Model<any>,
    tools: AgentTool<any, any>[],
): AgentTool<any, any>[] {
    if (!usesGeminiSchemaSubset(model)) {
        return tools;
    }
    return tools.map((tool) => ({
        ...tool,
        parameters: sanitizeGeminiSchema(tool.parameters as JsonRecord),
    }));
}

/**
 * Google GenAI / Gemini 的 FunctionDeclaration.parameters 只接受 Schema 子集。
 * 这里把 TypeBox/JSON Schema 中的扩展字段裁掉，并保留运行期真正需要的约束信息。
 */
export function sanitizeGeminiSchema(schema: JsonRecord): JsonRecord {
    return sanitizeGeminiSchemaNode(schema) as JsonRecord;
}

/**
 * 判断当前模型是否走 Gemini / Google GenAI 的 Schema 子集约束。
 */
function usesGeminiSchemaSubset(model: Model<any>): boolean {
    const provider = model.provider.trim().toLowerCase();
    const api = typeof model.api === "string" ? model.api.trim().toLowerCase() : "";
    return provider === "google-generative-ai"
        || provider === "google"
        || api === "google-generative-ai"
        || api === "google";
}

/**
 * 递归裁剪单个 schema 节点。
 */
function sanitizeGeminiSchemaNode(value: unknown): unknown {
    if (!isRecord(value)) {
        return value;
    }

    const normalized = normalizeGeminiSchema(value);
    const result: JsonRecord = {};

    for (const key of GEMINI_SCHEMA_ALLOWED_KEYS) {
        if (!(key in normalized)) {
            continue;
        }
        const nextValue = normalized[key];
        if (key === "properties" && isRecord(nextValue)) {
            result.properties = Object.fromEntries(Object.entries(nextValue).map(([propertyKey, propertyValue]) => [
                propertyKey,
                sanitizeGeminiSchemaNode(propertyValue),
            ]));
            continue;
        }
        if (key === "items") {
            result.items = sanitizeGeminiItems(nextValue);
            continue;
        }
        if (key === "anyOf" && Array.isArray(nextValue)) {
            result.anyOf = nextValue
                .map((item) => sanitizeGeminiSchemaNode(item))
                .filter((item) => isRecord(item));
            if ((result.anyOf as unknown[]).length === 0) {
                delete result.anyOf;
            }
            continue;
        }
        result[key] = nextValue;
    }

    return collapseNullableAnyOf(result);
}

/**
 * 把 tuple-style items / prefixItems 收敛到 Gemini 只接受的单一 items schema。
 */
function sanitizeGeminiItems(value: unknown): unknown {
    if (Array.isArray(value)) {
        const firstItem = value.find((item) => isRecord(item));
        return firstItem ? sanitizeGeminiSchemaNode(firstItem) : undefined;
    }
    return sanitizeGeminiSchemaNode(value);
}

/**
 * 先把常见 JSON Schema / TypeBox 形状正则化成 Gemini 更接近的形状。
 */
function normalizeGeminiSchema(schema: JsonRecord): JsonRecord {
    const normalized: JsonRecord = {...schema};

    if (Array.isArray(normalized.type)) {
        const typeValues = normalized.type.filter((item): item is string => typeof item === "string");
        const hasNullType = typeValues.includes("null");
        const nonNullTypes = typeValues.filter((item) => item !== "null");
        if (nonNullTypes.length === 1) {
            normalized.type = nonNullTypes[0];
            if (hasNullType) {
                normalized.nullable = true;
            }
        }
        else if (hasNullType) {
            normalized.nullable = true;
            delete normalized.type;
        }
    }

    if (Array.isArray(normalized.prefixItems) && normalized.items === undefined) {
        normalized.items = normalized.prefixItems;
    }

    if (Array.isArray(normalized.oneOf) && normalized.anyOf === undefined) {
        normalized.anyOf = normalized.oneOf;
    }

    if ("const" in normalized) {
        applyConstConstraint(normalized, normalized.const);
    }

    return normalized;
}

/**
 * Gemini Schema 不支持 const；把常见 literal 约束改写成等价或近似等价的支持字段。
 */
function applyConstConstraint(schema: JsonRecord, constValue: unknown): void {
    if (typeof constValue === "string") {
        schema.type = "string";
        schema.enum = [constValue];
        return;
    }
    if (typeof constValue === "number") {
        schema.type = Number.isInteger(constValue) ? "integer" : "number";
        schema.minimum = constValue;
        schema.maximum = constValue;
        return;
    }
    if (typeof constValue === "boolean") {
        schema.type = "boolean";
    }
}

/**
 * 把 anyOf:[X, null] 这种 TypeBox 常见写法收敛成 Gemini 原生 nullable。
 */
function collapseNullableAnyOf(schema: JsonRecord): JsonRecord {
    if (!Array.isArray(schema.anyOf)) {
        return schema;
    }
    const branches = schema.anyOf.filter((item): item is JsonRecord => isRecord(item));
    const nonNullBranches = branches.filter((branch) => branch.type !== "null");
    const hasNullBranch = nonNullBranches.length !== branches.length;
    if (!hasNullBranch) {
        return schema;
    }
    if (nonNullBranches.length === 1) {
        const branch = nonNullBranches[0];
        if (!branch) {
            return schema;
        }
        return {
            ...branch,
            nullable: true,
            title: schema.title ?? branch.title,
            description: schema.description ?? branch.description,
            default: schema.default ?? branch.default,
            example: schema.example ?? branch.example,
            propertyOrdering: schema.propertyOrdering ?? branch.propertyOrdering,
        };
    }
    return {
        ...schema,
        anyOf: nonNullBranches,
        nullable: true,
    };
}

/**
 * 判断未知值是否是普通对象。
 */
function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
