import {describe, expect, it} from "vitest";
import {
    ensureRunnableDefault,
    inspectSettingsDraft,
    previewModelLibraryRepairs,
    modelContractInput,
    type ContractSettingsDraft,
} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";

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

    it("Model Library 按精确 ID 补齐通用能力，但不猜测缺失 API", () => {
        const draft = createDraft();
        const model = draft.providers[0]!.models[0]!;
        model.id = "mimo-v2.5-pro";
        model.reasoning = "inherit";
        model.input = "";
        model.contextWindowTokens = "";
        model.maxTokens = "";

        const repairs = previewModelLibraryRepairs(draft, [mimoKnowledge()]);
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toMatchObject({
            source: "xiaomi",
            replacement: {
                api: "openai-completions",
                contextWindowTokens: 1_048_576,
                maxTokens: 131_072,
            },
        });
        model.api = "";
        expect(previewModelLibraryRepairs(draft, [mimoKnowledge()])).toEqual([]);
    });

    it("一键修复跳过重复 Provider/model 组，不删除、不禁用、不猜测保留项", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.id = "mimo-v2.5-pro";
        draft.providers[0]!.models[0]!.api = "";
        draft.providers[0]!.models.push({...draft.providers[0]!.models[0]!});

        expect(previewModelLibraryRepairs(draft, [mimoKnowledge()])).toEqual([]);
        expect(draft.providers[0]!.models.every((model) => model.enabled)).toBe(true);
    });

    it("disabled 不完整模型仍产生字段问题", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.enabled = false;
        draft.providers[0]!.models[0]!.api = "";
        expect(inspectSettingsDraft(draft).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing_api"}),
        ]));
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
            modelApi: "openai-completions",
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

function mimoKnowledge(): ModelLibraryEntryDto {
    return {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        source: "xiaomi",
        reasoning: true,
        thinkingLevelMap: null,
        input: ["text"],
        contextWindowTokens: 1_048_576,
        maxTokens: 131_072,
    };
}
