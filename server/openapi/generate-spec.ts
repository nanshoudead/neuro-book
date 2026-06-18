/**
 * Builds the full OpenAPI 3.0 spec object at runtime from the route map.
 *
 * Converts Zod schemas → JSON Schema via Zod v4's toJSONSchema()
 * and assembles paths, tags, parameters, requestBodies, and responses.
 */

import { z as z_ } from "zod";
import { routeMetaMap, type RouteMetaEntry } from "./route-map";

// ─── Spec metadata ──────────────────────────────────────────────

const SPEC_INFO = {
    title: "Neuro Book API",
    version: "1.0.0",
    description:
        "AI-powered novel writing platform — novels, chapters, plot management, settings, and workspace files",
};

// ─── Zod → JSON Schema conversion ───────────────────────────────

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
    if (schema && typeof schema === "object" && "toJSONSchema" in schema) {
        try {
            const result = (schema as { toJSONSchema: (opts: object) => unknown }).toJSONSchema({
                target: "openapi-3.0",
                unrepresentable: "ignore",
            });
            if (result && typeof result === "object") {
                return result as Record<string, unknown>;
            }
        } catch {
            // Fall through to empty schema
        }
    }
    return {};
}

// ─── Path builder ────────────────────────────────────────────────

/**
 * Convert a route file path to an OpenAPI path.
 *
 * server/api/  file                         →  OpenAPI path
 * ──────────────────────────────────────────────────────────
 * hello.get.ts                              →  /api/hello
 * novels/index.get.ts                       →  /api/novels
 * novels/[novelId].get.ts                   →  /api/novels/{novelId}
 * novels/[novelId]/chapters/[chapterId].get.ts → /api/novels/{novelId}/chapters/{chapterId}
 */
function buildPath(file: string, _entry: RouteMetaEntry): string {
    let path = file.replace(/\.(get|post|put|patch|delete)\.ts$/, "");
    // Convert [param] → {param}
    path = path.replace(/\[(\w+)\]/g, "{$1}");
    // Remove /index suffix
    path = path.replace(/\/index$/, "");
    return "/api/" + path;
}

// ─── Parameter extraction ───────────────────────────────────────

function extractPathParams(path: string): { name: string; in: string; required: true; schema: { type: "string" } }[] {
    const params: { name: string; in: string; required: true; schema: { type: "string" } }[] = [];
    const re = /\{(\w+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) {
        params.push({
            name: m[1]!,
            in: "path",
            required: true,
            schema: { type: "string" },
        });
    }
    return params;
}

// ─── Operation builder ──────────────────────────────────────────

function buildOperation(entry: RouteMetaEntry): Record<string, unknown> {
    const path = buildPath(entry.file, entry);
    const op: Record<string, unknown> = {
        tags: entry.tags,
        summary: entry.summary,
    };

    const pathParams = extractPathParams(path);
    const allParams: Record<string, unknown>[] = [...pathParams];

    // Query parameters
    if (entry.queryParams) {
        const jsonSchema = zodToJsonSchema(entry.queryParams);
        const props = (jsonSchema.properties as Record<string, Record<string, unknown>>) ?? {};
        const required = (jsonSchema.required as string[]) ?? [];
        for (const [name, schema] of Object.entries(props)) {
            allParams.push({
                name,
                in: "query",
                required: required.includes(name),
                schema,
                ...(schema.description ? { description: schema.description } : {}),
            });
        }
    }

    if (allParams.length > 0) {
        op.parameters = allParams;
    }

    // Request body
    if (entry.requestBody) {
        const schema = zodToJsonSchema(entry.requestBody);
        op.requestBody = {
            content: {
                "application/json": { schema },
            },
        };
    }

    // Responses
    op.responses = buildResponses(entry);

    return op;
}

function buildResponses(entry: RouteMetaEntry): Record<string, unknown> {
    const responses: Record<string, unknown> = {};

    if (entry.responseBody) {
        const schema = zodToJsonSchema(entry.responseBody);
        responses["200"] = {
            description: "OK",
            content: {
                "application/json": { schema },
            },
        };
    } else {
        responses["200"] = { description: "OK" };
    }

    // Always add 400 for routes with request body validation
    if (entry.requestBody && !responses["400"]) {
        responses["400"] = { description: "Bad Request — validation failed" };
    }

    return responses;
}

// ─── Spec assembly ──────────────────────────────────────────────

function buildOpenAPISpec(): Record<string, unknown> {
    const paths: Record<string, Record<string, Record<string, unknown>>> = {};

    for (const entry of routeMetaMap) {
        const path = buildPath(entry.file, entry);
        const operation = buildOperation(entry);
        if (!paths[path]) {
            paths[path] = {};
        }
        paths[path][entry.method] = operation;
    }

    // Collect unique tags in order of first appearance
    const seenTags = new Set<string>();
    const tags: { name: string }[] = [];
    for (const entry of routeMetaMap) {
        for (const tag of entry.tags) {
            if (!seenTags.has(tag)) {
                seenTags.add(tag);
                tags.push({ name: tag });
            }
        }
    }

    return {
        openapi: "3.0.3",
        info: SPEC_INFO,
        servers: [
            {
                url: "http://localhost:3000",
                description: "Development server",
            },
        ],
        tags,
        paths,
    };
}

// ─── Cached export ──────────────────────────────────────────────

let cachedSpec: Record<string, unknown> | null = null;

export function generateOpenAPISpec(): Record<string, unknown> {
    if (!cachedSpec) {
        cachedSpec = buildOpenAPISpec();
    }
    return cachedSpec;
}
