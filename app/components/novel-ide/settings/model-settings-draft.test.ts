import {describe, expect, it} from "vitest";
import {
    disableInvalidDrafts,
    clearUnsupportedDefaultApis,
    ensureRunnableDefault,
    inspectSettingsDraft,
    previewCatalogRepairs,
    modelContractInput,
    type ContractSettingsDraft,
} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ModelCatalogEntryDto} from "nbook/shared/dto/app-settings.dto";

describe("model settings draft contract", () => {
    it("草稿补齐后实时 issue 立即消失", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.api = "";
        expect(inspectSettingsDraft(draft).issues[0]?.code).toBe("missing_api");

        draft.providers[0]!.models[0]!.api = "openai-completions";
        expect(inspectSettingsDraft(draft).issues).toEqual([]);
    });

    it("默认模型和候选只接受 runnable 模型", () => {
        const draft = createDraft();
        draft.providers[0]!.options.baseURL = "";
        expect(ensureRunnableDefault(draft)).toEqual(new Set());
        expect(draft.defaultModelKey).toBeNull();
    });

    it("Catalog 批量修复按精确 ID 命中，非法旧 API 回退到 Catalog defaultApi", () => {
        const draft = createDraft();
        const model = draft.providers[0]!.models[0]!;
        model.id = "mimo-v2.5-pro";
        model.api = "legacy-api";
        model.reasoning = "inherit";
        model.input = "";
        model.contextWindowTokens = "";
        model.maxTokens = "";
        draft.providers[0]!.defaultApi = "legacy-api";

        const repairs = previewCatalogRepairs(draft, [mimoCatalog()]);
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toMatchObject({
            canonicalSource: "xiaomi",
            replacement: {
                api: "openai-completions",
                contextWindowTokens: 1_048_576,
                maxTokens: 131_072,
                compat: {maxTokensField: "max_tokens"},
            },
        });
    });

    it("禁用 Catalog 无法修复的剩余无效模型", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.api = "";
        expect(disableInvalidDrafts(draft)).toEqual(["local/model"]);
        expect(draft.providers[0]!.models[0]!.enabled).toBe(false);
        expect(draft.defaultModelKey).toBeNull();
    });

    it("一键修复跳过重复 Provider/model 组，不删除、不禁用、不猜测保留项", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.id = "mimo-v2.5-pro";
        draft.providers[0]!.models[0]!.api = "";
        draft.providers[0]!.models.push({...draft.providers[0]!.models[0]!});

        expect(previewCatalogRepairs(draft, [mimoCatalog()])).toEqual([]);
        expect(disableInvalidDrafts(draft)).toEqual([]);
        expect(draft.providers[0]!.models.every((model) => model.enabled)).toBe(true);
    });

    it("一键修复只清空非法 defaultApi，不替用户猜测 API", () => {
        const draft = createDraft();
        draft.providers[0]!.defaultApi = "legacy-api";

        expect(clearUnsupportedDefaultApis(draft)).toBe(1);
        expect(draft.providers[0]!.defaultApi).toBe("");
    });

    it("小数 token limit 作为无效字段处理，不会截断后进入 payload", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.contextWindowTokens = "8192.5";

        expect(modelContractInput(draft.providers[0]!.models[0]!).contextWindowTokens).toBeNull();
        expect(inspectSettingsDraft(draft).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing_context_window"}),
        ]));
    });
});

function createDraft(): ContractSettingsDraft {
    return {
        defaultModelKey: "local/model",
        providers: [{
            id: "local",
            enabled: true,
            defaultApi: "openai-completions",
            options: {baseURL: "https://example.com/v1"},
            models: [{
                id: "model",
                enabled: true,
                api: "openai-completions",
                reasoning: "false",
                input: "text",
                contextWindowTokens: "8192",
                maxTokens: "4096",
            }],
        }],
    };
}

function mimoCatalog(): ModelCatalogEntryDto {
    return {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        canonicalSource: "xiaomi",
        defaultApi: "openai-completions",
        reasoning: true,
        thinkingLevelMap: null,
        input: ["text"],
        cost: null,
        contextWindowTokens: 1_048_576,
        maxTokens: 131_072,
        compatByApi: {"openai-completions": {maxTokensField: "max_tokens"}},
        headersByApi: {"openai-completions": null},
    };
}
