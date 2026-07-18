import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useModelSettingsDraftSession} from "nbook/app/components/novel-ide/settings/useModelSettingsDraftSession";
import type {ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

vi.mock("nbook/app/composables/useConfigApi", () => ({
    useConfigApi: () => ({editorSnapshot: vi.fn(), saveGlobal: vi.fn(), saveProject: vi.fn()}),
}));

vi.mock("nbook/app/stores/novel-ide", () => ({
    useNovelIdeStore: () => ({setSelectedModelLabel: vi.fn()}),
}));

describe("Provider Config draft frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("新模型 API 只进入 Provider 请求提示，模型仍保存自己的 API", () => {
        const session = createSession();
        const provider = createProvider();
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;

        session.enableModel(configuredModel());

        expect(session.buildProviderRequest(provider)).toMatchObject({modelApi: "openai-responses"});
        expect(provider.models[0]).toMatchObject({api: "openai-responses", enabled: true});
        expect(session.draft.value.defaultModelKey).toBe("provider/model");
    });

    it("Provider ID 重命名会迁移默认模型并通知临时会话", () => {
        const renameDiscovery = vi.fn();
        const cancelProviderChecks = vi.fn();
        const session = createSession({renameDiscovery, cancelProviderChecks});
        const provider = createProvider();
        provider.models.push(session.cloneModel(configuredModel()));
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;
        session.draft.value.defaultModelKey = "provider/model";

        session.renameActiveProviderId("renamed");

        expect(session.draft.value.defaultModelKey).toBe("renamed/model");
        expect(renameDiscovery).toHaveBeenCalledWith("provider", "renamed");
        expect(cancelProviderChecks).toHaveBeenCalledWith(provider, true);
    });
});

/** 创建被测 Config 草稿会话。 */
function createSession(overrides: Partial<Parameters<typeof useModelSettingsDraftSession>[0]> = {}) {
    return useModelSettingsDraftSession({
        props: {scope: "global", targetLabel: ""},
        loadLibraries: async () => ({models: []}),
        resetChecks: () => undefined,
        cancelProviderChecks: () => undefined,
        cancelModelCheck: () => undefined,
        resetDiscovery: () => undefined,
        renameDiscovery: () => undefined,
        removeDiscovery: () => undefined,
        ...overrides,
    });
}

/** 创建 Provider Config 草稿。 */
function createProvider(): ModelSettingsProviderDraft {
    return {
        localKey: "provider-local",
        id: "provider",
        name: "Provider",
        enabled: true,
        modelApi: "openai-responses",
        options: {
            apiKey: "",
            apiKeyConfigured: false,
            apiKeyMaskedValue: null,
            apiKeyCleared: false,
            baseURL: "https://example.com/v1",
            proxy: "",
            timeoutMs: "",
            requestOptions: "",
        },
        models: [],
    };
}

/** 创建完整模型 DTO。 */
function configuredModel(): ConfiguredModelDto {
    return {
        name: "Model",
        id: "model",
        group: "group",
        enabled: true,
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
    };
}
