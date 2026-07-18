import {EventEmitter} from "node:events";
import {beforeEach, describe, expect, it, vi} from "vitest";

type TestRequest = EventEmitter & {
    aborted: boolean;
};

type TestResponse = EventEmitter & {
    destroyed: boolean;
    writableEnded: boolean;
};

type ModelCheckTestEvent = {
    body: unknown;
    node: {
        req: TestRequest;
        res: TestResponse;
    };
};

type CheckModelResponse = {
    success: boolean;
    latencyMs: number | null;
    message: string;
};

type CheckModelOptions = {
    signal?: AbortSignal;
    trace?: unknown;
};

function createTestEvent(body: unknown): ModelCheckTestEvent {
    const req = new EventEmitter() as TestRequest;
    req.aborted = false;
    const res = new EventEmitter() as TestResponse;
    res.destroyed = false;
    res.writableEnded = false;

    return {
        body,
        node: {
            req,
            res,
        },
    };
}

function createProviderDraft() {
    return {
        id: "custom",
        name: "Custom",
        modelApi: "openai-completions",
        options: {
            apiKey: "",
            baseURL: "https://example.com/v1",
            proxy: "",
            timeoutMs: null,
            requestOptions: {},
        },
    };
}

function createModelDraft() {
    return {
        name: "Draft",
        id: "draft-model",
        group: null,
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        maxTokens: 1024,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
    };
}

function createRequestBody(options: {useSavedApiKey: boolean} = {useSavedApiKey: false}) {
    return {
        provider: createProviderDraft(),
        model: createModelDraft(),
        useSavedApiKey: options.useSavedApiKey,
    };
}

function mockConfigService(): void {
    vi.doMock("nbook/server/config/config-service", () => ({
        loadGlobalEffectiveConfigSync: vi.fn(() => ({
            models: {
                providers: {
                    custom: {
                        options: {apiKey: "sk-saved"},
                    },
                },
            },
        })),
    }));
    vi.doMock("nbook/server/agent/http", () => ({
        useAgentHarness: vi.fn(() => ({
            traceBinding: vi.fn(() => ({kind: "test-trace"})),
        })),
    }));
}

describe("POST /api/config/models/model-check", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async (event: {body?: unknown}) => event.body),
        }));
    });

    it("禁用 API Key 回退时不会补齐已保存密钥", async () => {
        const checkModelHealth = vi.fn(async () => ({
            success: false,
            latencyMs: null,
            message: "checked",
        }));
        mockConfigService();
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkModelHealth,
            withSavedProviderApiKey: vi.fn((provider, savedApiKey) => ({
                ...provider,
                options: {
                    ...provider.options,
                    apiKey: provider.options.apiKey || savedApiKey || "",
                },
            })),
        }));

        const body = createRequestBody({useSavedApiKey: false});
        const event = createTestEvent(body);

        const handler = (await import("nbook/server/api/config/models/model-check.post")).default;
        await handler(event as never);

        expect(checkModelHealth).toHaveBeenCalledWith(body.provider, body.model, {
            signal: expect.any(AbortSignal),
            trace: {kind: "test-trace"},
        });
        const options = checkModelHealth.mock.calls[0]?.[2] as CheckModelOptions | undefined;
        expect(options?.signal?.aborted).toBe(false);
        expect(event.node.req.listenerCount("aborted")).toBe(0);
        expect(event.node.req.listenerCount("close")).toBe(0);
        expect(event.node.res.listenerCount("close")).toBe(0);
    });

    it("请求中断时会 abort 传给模型检查的 signal 并清理监听器", async () => {
        let capturedSignal: AbortSignal | null = null;
        let resolveStarted: () => void = () => undefined;
        let resolveCheck: (response: CheckModelResponse) => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            resolveStarted = resolve;
        });
        const pendingCheck = new Promise<CheckModelResponse>((resolve) => {
            resolveCheck = resolve;
        });
        const checkModelHealth = vi.fn((_provider, _model, options?: CheckModelOptions) => {
            capturedSignal = options?.signal ?? null;
            resolveStarted();
            return pendingCheck;
        });
        mockConfigService();
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkModelHealth,
            withSavedProviderApiKey: vi.fn((provider) => provider),
        }));

        const event = createTestEvent(createRequestBody());
        const handler = (await import("nbook/server/api/config/models/model-check.post")).default;
        const result = handler(event as never);
        await started;

        expect(capturedSignal?.aborted).toBe(false);
        event.node.req.aborted = true;
        event.node.req.emit("aborted");
        expect(capturedSignal?.aborted).toBe(true);

        resolveCheck({
            success: false,
            latencyMs: null,
            message: "aborted",
        });
        await result;

        expect(event.node.req.listenerCount("aborted")).toBe(0);
        expect(event.node.req.listenerCount("close")).toBe(0);
        expect(event.node.res.listenerCount("close")).toBe(0);
    });

    it("响应非正常关闭时会 abort 传给模型检查的 signal", async () => {
        let capturedSignal: AbortSignal | null = null;
        let resolveStarted: () => void = () => undefined;
        let resolveCheck: (response: CheckModelResponse) => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            resolveStarted = resolve;
        });
        const pendingCheck = new Promise<CheckModelResponse>((resolve) => {
            resolveCheck = resolve;
        });
        const checkModelHealth = vi.fn((_provider, _model, options?: CheckModelOptions) => {
            capturedSignal = options?.signal ?? null;
            resolveStarted();
            return pendingCheck;
        });
        mockConfigService();
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkModelHealth,
            withSavedProviderApiKey: vi.fn((provider) => provider),
        }));

        const event = createTestEvent(createRequestBody());
        const handler = (await import("nbook/server/api/config/models/model-check.post")).default;
        const result = handler(event as never);
        await started;

        expect(capturedSignal?.aborted).toBe(false);
        event.node.res.emit("close");
        expect(capturedSignal?.aborted).toBe(true);

        resolveCheck({
            success: false,
            latencyMs: null,
            message: "aborted",
        });
        await result;

        expect(event.node.req.listenerCount("aborted")).toBe(0);
        expect(event.node.req.listenerCount("close")).toBe(0);
        expect(event.node.res.listenerCount("close")).toBe(0);
    });
});
