import {effectScope, nextTick, type EffectScope} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useProviderSettingsBinding} from "nbook/app/composables/useProviderSettingsBinding";
import type {ConfigEditorSnapshotDto} from "nbook/shared/dto/config.dto";

const {saveGlobal} = vi.hoisted(() => ({
    saveGlobal: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
    useI18n: () => ({t: (key: string) => key}),
}));

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: () => undefined, error: () => undefined, warning: () => undefined, info: () => undefined}),
}));

vi.mock("nbook/app/stores/novel-ide", () => ({
    useNovelIdeStore: () => ({
        setSelectedModelLabel: () => undefined,
        bumpConfigRevision: () => undefined,
        workspaceKind: "user-assets",
        currentProjectRoot: "",
    }),
}));

vi.mock("nbook/app/composables/useConfigApi", () => ({
    useConfigApi: () => ({
        editorSnapshot: async () => savedSnapshot(),
        saveGlobal,
        saveProject: async () => savedSnapshot(),
        modelLibrary: async () => ({models: []}),
        providerTemplates: async () => ({templates: []}),
    }),
}));

describe("模型连接的自动保存", () => {
    let scope: EffectScope | undefined;

    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
        saveGlobal.mockReset();
        saveGlobal.mockImplementation(async () => savedSnapshot());
        scope = effectScope();
    });

    afterEach(() => {
        scope?.stop();
        vi.unstubAllGlobals();
    });

    it("复制出来的连接可以先改 API Base，离开前不会写回", async () => {
        const binding = scope!.run(() => useProviderSettingsBinding({
            scope: () => "global",
            targetQuery: () => ({workspaceKind: "user-assets"}),
            targetLabel: () => "",
            enabled: () => true,
            saveDelayMs: 0,
        }))!;
        await waitUntilLoaded(binding);

        binding.viewBindings.value["onClone-provider-connection"]();
        const clone = binding.viewBindings.value.draft.providers.find((provider) => provider.id === "deepseek-copy");
        expect(clone?.sourceIndex).toBeUndefined();
        binding.viewBindings.value["onUpdate:draft"]({
            ...binding.viewBindings.value.draft,
            providers: binding.viewBindings.value.draft.providers.map((provider) => provider.localKey === clone?.localKey
                ? {...provider, options: {...provider.options, baseURL: "https://new.example/v1"}}
                : provider),
        });
        await yieldMacrotask();

        expect(saveGlobal).not.toHaveBeenCalled();

        await binding.flushSave();

        expect(saveGlobal).toHaveBeenCalledTimes(1);
        const providers = saveGlobal.mock.calls[0]?.[0].models?.providers ?? [];
        expect(providers).toContainEqual(expect.objectContaining({
            id: "deepseek-copy",
            options: expect.objectContaining({baseURL: "https://new.example/v1"}),
        }));
        expect(providers.find((provider: {id: string; sourceIndex?: number}) => provider.id === "deepseek-copy")?.sourceIndex).toBeUndefined();
    });

    it("已保存连接的名称改动仍会写回", async () => {
        const binding = scope!.run(() => useProviderSettingsBinding({
            scope: () => "global",
            targetQuery: () => ({workspaceKind: "user-assets"}),
            targetLabel: () => "",
            enabled: () => true,
            saveDelayMs: 0,
        }))!;
        await waitUntilLoaded(binding);

        const draft = binding.viewBindings.value.draft;
        binding.viewBindings.value["onUpdate:draft"]({
            ...draft,
            providers: draft.providers.map((provider) => provider.id === "deepseek" ? {...provider, name: "改名"} : provider),
        });
        await yieldMacrotask();

        expect(saveGlobal).toHaveBeenCalledTimes(1);
        const providers = saveGlobal.mock.calls[0]?.[0].models?.providers ?? [];
        expect(providers).toContainEqual(expect.objectContaining({id: "deepseek", name: "改名"}));
    });
});

/** 已落盘的一条连接。复制它不应立刻再写一次。 */
function savedSnapshot(): ConfigEditorSnapshotDto {
    return {
        version: "1",
        workspaceKind: "user-assets",
        global: {},
        project: null,
        effective: {},
        meta: [],
        embeddingSettings: {},
        defaultProfileSettings: {},
        modelSettings: {
            defaultModelKey: null,
            defaultModelLabel: "",
            agentVisibleModels: [],
            enabledModels: [],
            providers: [{
                sourceIndex: 0,
                id: "deepseek",
                name: "DeepSeek",
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: {configured: true, maskedValue: "sk-...key"},
                    baseURL: "https://api.deepseek.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
                models: [],
            }],
        },
    } as ConfigEditorSnapshotDto;
}

/** 等配置读完。读快照是已完成的 Promise，不需要按墙钟等待。 */
async function waitUntilLoaded(binding: {loaded: {value: boolean}}): Promise<void> {
    for (let attempt = 0; attempt < 20 && !binding.loaded.value; attempt += 1) {
        await Promise.resolve();
        await nextTick();
    }
    expect(binding.loaded.value).toBe(true);
}

/** 让出一轮事件循环，让延迟为 0 的写回有机会发生。 */
async function yieldMacrotask(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
