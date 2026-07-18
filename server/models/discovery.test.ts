import {afterEach, describe, expect, it, vi} from "vitest";
import {discoverProviderModelMetadata} from "nbook/server/models/discovery";
import type {ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";

describe("Automatic Model Discovery", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("OpenRouter 主机优先使用扩展字段并归一化价格", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{
            id: "vendor/model",
            context_length: 128000,
            top_provider: {max_completion_tokens: 16000},
            architecture: {input_modalities: ["text", "image"]},
            pricing: {prompt: "0.000001", completion: "0.000002"},
        }]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const [model] = await discoverProviderModelMetadata(createProvider("https://openrouter.ai/api/v1"));
        expect(model).toMatchObject({
            id: "vendor/model",
            api: "openai-completions",
            contextWindowTokens: 128000,
            maxTokens: 16000,
            input: ["text", "image"],
            cost: {input: 1, output: 2},
        });
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({redirect: "error"});
    });

    it("普通 OpenAI-compatible /models 不猜测 Completions 或 Responses", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({data: [{id: "responses-only"}]}))) as unknown as typeof fetch;

        const [model] = await discoverProviderModelMetadata(createProvider("https://example.com/v1", "", "openai-responses"));
        expect(model).toMatchObject({id: "responses-only", api: null});
    });

    it("Google 主机使用 query key，不发送 Authorization", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({models: [{
            name: "models/gemini-test",
            displayName: "Gemini Test",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent"],
        }]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const [model] = await discoverProviderModelMetadata(createProvider("https://generativelanguage.googleapis.com/v1beta", "secret"));
        expect(model).toMatchObject({id: "gemini-test", api: "google-generative-ai", contextWindowTokens: 1048576});
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.origin).toBe("https://generativelanguage.googleapis.com");
        expect(url.searchParams.get("key")).toBe("secret");
        expect(new Headers(init.headers).has("authorization")).toBe(false);
    });

    it("未知 Provider 响应不匹配时不切换认证形式", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({unexpected: []})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1", "secret"))).rejects.toThrow("未发现可用模型");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.searchParams.has("key")).toBe(false);
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
    });

    it("Custom Provider 可用明确 modelApi 选择 Google Adapter", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({models: [{
            name: "models/gemini-custom",
            inputTokenLimit: 128000,
            outputTokenLimit: 8192,
        }]})));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const [model] = await discoverProviderModelMetadata(createProvider("https://google-proxy.example/v1beta", "secret", "google-generative-ai"));
        expect(model).toMatchObject({id: "gemini-custom", api: "google-generative-ai"});
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.searchParams.get("key")).toBe("secret");
        expect(new Headers(init.headers).has("authorization")).toBe(false);
    });

    it("拒绝超过大小限制的发现响应", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {
            headers: {"content-length": String(6 * 1024 * 1024)},
        })) as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1"))).rejects.toThrow("未发现可用模型");
    });

    it("Bun fetch 的 AbortError 会转换为明确超时诊断", async () => {
        const provider = createProvider("https://example.com/v1");
        provider.options.timeoutMs = 5;
        globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, {once: true});
        })) as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(provider)).rejects.toThrow("请求超时");
    });

    it("Content-Length 缺失时仍在流式读取阶段限制响应体", async () => {
        const chunk = new Uint8Array(1024 * 1024);
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let index = 0; index < 6; index += 1) {
                    controller.enqueue(chunk);
                }
                controller.close();
            },
        });
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(body)) as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://example.com/v1"))).rejects.toThrow("未发现可用模型");
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("Anthropic 与 Bedrock 明确提示不支持自动发现且不发送请求", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(discoverProviderModelMetadata(createProvider("https://api.anthropic.com", "secret", "anthropic-messages"))).rejects.toThrow("不支持自动发现");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function createProvider(baseURL: string, apiKey = "", modelApi: ModelProviderDraftDto["modelApi"] = null): ModelProviderDraftDto {
    return {
        id: "test",
        name: "Test",
        modelApi,
        options: {apiKey, baseURL, proxy: "", timeoutMs: null, requestOptions: {}},
    };
}
