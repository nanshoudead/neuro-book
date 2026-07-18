import {computed, ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useModelDiscoverySession} from "nbook/app/components/novel-ide/settings/useModelDiscoverySession";
import type {ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {DiscoveredProviderModelDto, ModelLibraryDto} from "nbook/shared/dto/app-settings.dto";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

describe("Automatic Model Discovery frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("发现列表只包含本次远端结果，不混入 Provider 已保存但未发现的模型", async () => {
        const provider = createProvider({
            models: [
                createModel("remote-model", true),
                createModel("saved-only", true),
                createModel("disabled-only", false),
            ],
        });
        vi.stubGlobal("$fetch", vi.fn(async () => ({
            models: [remoteModel({id: "remote-model", name: "Remote"})],
            message: "ok",
        })));
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value.flatMap((group) => group.models.map((model) => model.id))).toEqual(["remote-model"]);
        expect(session.discoveryGroups.value[0]?.models[0]?.state).toBe("enabled");
    });

    it("普通 OpenAI 发现使用 Provider Model API 补全 Responses", async () => {
        const provider = createProvider({modelApi: "openai-responses", models: []});
        vi.stubGlobal("$fetch", vi.fn(async () => ({
            models: [remoteModel({api: null})],
            message: "ok",
        })));
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value[0]?.models[0]).toMatchObject({
            state: "remote-complete",
            completeModel: {api: "openai-responses"},
        });
    });

    it("缺少 Provider Model API 时保持为不可持久化候选", async () => {
        const provider = createProvider({modelApi: "", models: []});
        vi.stubGlobal("$fetch", vi.fn(async () => ({
            models: [remoteModel({api: null})],
            message: "ok",
        })));
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value[0]?.models[0]).toMatchObject({
            state: "remote-incomplete",
            incompleteCandidate: {api: null},
        });
        expect(session.discoveryGroups.value[0]?.models[0]).not.toHaveProperty("completeModel");
    });
});

/** 创建被测发现会话。 */
function createSession(provider: ModelSettingsProviderDraft) {
    const activeProvider = computed(() => provider);
    const modelLibrary = ref<ModelLibraryDto>({models: []});
    return useModelDiscoverySession({
        activeProvider,
        modelLibrary,
        loadLibraries: async () => modelLibrary.value,
        findLibraryModel: () => null,
        buildProviderRequest: (value) => ({
            id: value.id,
            name: value.name,
            modelApi: value.modelApi === "openai-responses" ? "openai-responses" : null,
            options: {apiKey: "", baseURL: value.options.baseURL, proxy: "", timeoutMs: null, requestOptions: {}},
        }),
        enableModel: () => undefined,
        disableModel: () => undefined,
        openTransientCandidate: async () => undefined,
        ensureDefaultModel: () => undefined,
    });
}

/** 创建 Provider Config 草稿。 */
function createProvider(overrides: Partial<ModelSettingsProviderDraft> = {}): ModelSettingsProviderDraft {
    return {
        localKey: "provider-local",
        id: "provider",
        name: "Provider",
        enabled: true,
        modelApi: "openai-completions",
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
        ...overrides,
    };
}

/** 创建完整已保存模型草稿。 */
function createModel(id: string, enabled: boolean): ModelSettingsProviderDraft["models"][number] {
    return {
        localKey: `model-${id}`,
        name: id,
        id,
        group: "group",
        enabled,
        api: "openai-completions",
        reasoning: "false",
        input: "text",
        maxTokens: "4096",
        cost: {input: "", output: "", cacheRead: "", cacheWrite: "", tiers: []},
        compat: "",
        headers: "",
        thinkingLevelMap: "",
        contextWindowTokens: "8192",
    };
}

/** 创建远程发现 DTO。 */
function remoteModel(overrides: Partial<DiscoveredProviderModelDto> = {}): DiscoveredProviderModelDto {
    return {
        id: "remote-model",
        name: "Remote Model",
        group: "remote",
        api: null,
        reasoning: false,
        input: ["text"],
        contextWindowTokens: 8192,
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        ...overrides,
    };
}
