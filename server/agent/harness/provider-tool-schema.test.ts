import {describe, expect, it} from "vitest";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {Model} from "@earendil-works/pi-ai";
import {sanitizeProviderVisibleToolsForModel} from "nbook/server/agent/harness/provider-tool-schema";

describe("sanitizeProviderVisibleToolsForModel", () => {
    it("Gemini provider 会裁掉不受支持的 schema keyword，并保留常用约束", () => {
        const tool = createTool({
            type: "object",
            properties: {
                recentMessageRoles: {
                    type: "array",
                    minItems: 1,
                    uniqueItems: true,
                    items: {
                        oneOf: [
                            {type: "string", const: "user"},
                            {type: "string", const: "assistant"},
                        ],
                    },
                },
                note: {
                    oneOf: [
                        {type: "string", minLength: 1, pattern: "^[a-z]+$"},
                        {type: "null"},
                    ],
                },
                score: {
                    type: "integer",
                    minimum: 1,
                    maximum: 5,
                },
            },
            required: ["recentMessageRoles"],
            additionalProperties: false,
        });

        const [sanitized] = sanitizeProviderVisibleToolsForModel(createModel({
            provider: "google-generative-ai",
            api: "google-generative-ai",
        }), [tool]);
        if (!sanitized) {
            throw new Error("Expected sanitized tool");
        }
        const schema = sanitized.parameters as Record<string, any>;

        expect(schema.additionalProperties).toBeUndefined();
        expect(schema.required).toEqual(["recentMessageRoles"]);
        expect(schema.properties.recentMessageRoles.uniqueItems).toBeUndefined();
        expect(schema.properties.recentMessageRoles.minItems).toBe(1);
        expect(schema.properties.recentMessageRoles.items.anyOf).toEqual([
            {type: "string", enum: ["user"]},
            {type: "string", enum: ["assistant"]},
        ]);
        expect(schema.properties.note).toEqual({
            type: "string",
            minLength: 1,
            pattern: "^[a-z]+$",
            nullable: true,
        });
        expect(schema.properties.score).toEqual({
            type: "integer",
            minimum: 1,
            maximum: 5,
        });
    });

    it("非 Gemini provider 不会改写原始工具 schema", () => {
        const tool = createTool({
            type: "object",
            properties: {
                roles: {
                    type: "array",
                    uniqueItems: true,
                    items: {type: "string"},
                },
            },
        });

        const [sanitized] = sanitizeProviderVisibleToolsForModel(createModel({
            provider: "deepseek",
            api: "openai-completions",
        }), [tool]);
        if (!sanitized) {
            throw new Error("Expected original tool");
        }

        expect(sanitized).toBe(tool);
    });
});

/**
 * 构造测试工具，聚焦 schema 适配逻辑本身。
 */
function createTool(parameters: Record<string, unknown>): AgentTool<any, any> {
    return {
        name: "get_session",
        label: "Get Session",
        description: "test tool",
        parameters,
        async execute() {
            return {
                content: [{type: "text", text: "ok"}],
                details: {ok: true},
            };
        },
    };
}

/**
 * 构造最小模型对象，仅填入 schema 分流需要的 provider/api。
 */
function createModel(input: {provider: string; api: string}): Model<any> {
    return {
        id: "test-model",
        name: "Test Model",
        provider: input.provider as never,
        api: input.api as never,
        baseUrl: "",
        input: ["text"],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        reasoning: false,
        contextWindow: 128_000,
        maxTokens: 8_192,
    };
}
