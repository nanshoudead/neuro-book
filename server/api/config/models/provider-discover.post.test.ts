import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/models/provider-discover", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async (event: {body?: unknown}) => event.body),
        }));
    });

    it("saved连接身份不匹配时保留400且发现Adapter零调用", async () => {
        const discoverProviderModels = vi.fn();
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {providers: {custom: {
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "sk-saved", baseURL: "https://saved.example/v1", proxy: ""},
                    models: {},
                }}},
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await expect(handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-completions",
                options: {apiKey: "request-secret", baseURL: "https://changed.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "saved",
        }} as never)).rejects.toMatchObject({statusCode: 400});
        expect(discoverProviderModels).not.toHaveBeenCalled();
    });

    it("saved凭据允许在原端点使用新的 Provider Model API", async () => {
        const discoverProviderModels = vi.fn(async (provider) => ({provider}));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {providers: {custom: {
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "sk-saved", baseURL: "https://saved.example/v1", proxy: ""},
                    models: {},
                }}},
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({discoverProviderModels}));

        const handler = (await import("nbook/server/api/config/models/provider-discover.post")).default;
        await handler({body: {
            provider: {
                id: "custom",
                name: "Custom",
                modelApi: "openai-responses",
                options: {apiKey: "", baseURL: "https://saved.example/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            },
            credentialSource: "saved",
        }} as never);

        expect(discoverProviderModels).toHaveBeenCalledWith(expect.objectContaining({
            modelApi: "openai-responses",
            options: expect.objectContaining({apiKey: "sk-saved"}),
        }));
    });
});
