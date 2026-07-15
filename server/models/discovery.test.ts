import {afterEach, describe, expect, it, vi} from "vitest";
import {discoverProviderModelMetadata} from "nbook/server/models/discovery";
import type {ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";

describe("Provider Discovery Adapter", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("OpenRouter 扩展字段归一化为统一能力", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "vendor/model",
            context_length: 128000,
            top_provider: {max_completion_tokens: 16000},
            architecture: {input_modalities: ["text", "image"]},
            pricing: {prompt: "0.000001", completion: "0.000002"},
        }]}))) as unknown as typeof fetch;

        const [model] = await discoverProviderModelMetadata(createProvider("openrouter-models"));
        expect(model).toMatchObject({
            id: "vendor/model",
            contextWindowTokens: 128000,
            maxTokens: 16000,
            input: ["text", "image"],
            cost: {input: 1, output: 2},
        });
    });

    it("Google 不同响应 path 归一化 token limits", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({models: [{
            name: "models/gemini-test",
            displayName: "Gemini Test",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent"],
        }]}))) as unknown as typeof fetch;

        expect(await discoverProviderModelMetadata(createProvider("google-models"))).toEqual([
            expect.objectContaining({id: "gemini-test", contextWindowTokens: 1048576, maxTokens: 65536}),
        ]);
    });

    it("重复 ID 只保留第一条，非法或缺失元数据保持 null", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [
            {id: "same", context_length: -1},
            {id: "same", context_length: 100},
        ]}))) as unknown as typeof fetch;

        const models = await discoverProviderModelMetadata(createProvider("openai-models"));
        expect(models).toHaveLength(1);
        expect(models[0]?.contextWindowTokens).toBeNull();
    });
});

function createProvider(adapter: ModelProviderDraftDto["discovery"]["adapter"]): ModelProviderDraftDto {
    return {
        id: "test",
        name: "Test",
        defaultApi: adapter === "google-models" ? "google-generative-ai" : "openai-completions",
        discovery: {adapter, endpointPath: null},
        options: {apiKey: "", baseURL: "http://127.0.0.1:1234/v1", proxy: "", timeoutMs: null, requestOptions: {}},
    };
}
