import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/models/provider-check", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("readBody", (event: {body?: unknown}) => event.body);
    });

    it("草稿没有启用模型且禁用保存模型回退时不会使用旧模型", async () => {
        const checkProviderConnection = vi.fn(async (_provider, modelDrafts) => ({
            success: false,
            latencyMs: null,
            message: String(modelDrafts.length),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {
                    providers: {
                        custom: {
                            enabled: true,
                            defaultApi: "openai-completions",
                            discovery: {adapter: "none", endpointPath: null},
                            options: {apiKey: "sk-saved"},
                            models: {
                                "saved-model": {
                                    name: "Saved",
                                    id: "saved-model",
                                    group: null,
                                    enabled: true,
                                    api: "openai-completions",
                                    reasoning: false,
                                    input: ["text"],
                                    maxTokens: 1024,
                                    cost: null,
                                    compat: null,
                                    headers: null,
                                    thinkingLevelMap: null,
                                    contextWindowTokens: 8192,
                                },
                            },
                        },
                    },
                },
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkProviderConnection,
            withSavedProviderApiKey: vi.fn((provider, savedApiKey) => ({
                ...provider,
                options: {
                    ...provider.options,
                    apiKey: provider.options.apiKey || savedApiKey || "",
                },
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({
                traceBinding: vi.fn(() => ({kind: "test-trace"})),
            })),
        }));

        const handler = (await import("nbook/server/api/config/models/provider-check.post")).default;
        await handler({
            body: {
                provider: {
                    id: "custom",
                    name: "Custom",
                    defaultApi: "openai-completions",
                    discovery: {adapter: "none", endpointPath: null},
                    options: {
                        apiKey: "",
                        baseURL: "https://example.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                },
                models: [],
                useSavedApiKey: true,
                useSavedModels: false,
            },
        } as never);

        expect(checkProviderConnection).toHaveBeenCalledWith(expect.anything(), [], {
            trace: {kind: "test-trace"},
        });
    });
});
