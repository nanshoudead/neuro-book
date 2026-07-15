import {describe, expect, it} from "vitest";
import {resolveDiscoveredModelDraft} from "nbook/app/components/novel-ide/settings/model-draft-factory";
import type {DiscoveredProviderModelDto, ModelCatalogEntryDto} from "nbook/shared/dto/app-settings.dto";

describe("Model Draft Factory", () => {
    it("完整远程 metadata 直接采用", () => {
        const remote = discovered({reasoning: false, input: ["text"], contextWindowTokens: 32000, maxTokens: 4000});
        expect(resolveDiscoveredModelDraft(remote, catalog(), "openai-completions")).toMatchObject({source: "discovery", model: {enabled: true, contextWindowTokens: 32000}});
    });

    it("不完整远程 metadata 用 Catalog 能力整块替换", () => {
        const result = resolveDiscoveredModelDraft(discovered({contextWindowTokens: 123}), catalog(), "openai-completions");
        expect(result).toMatchObject({
            source: "catalog",
            canonicalSource: "vendor",
            model: {contextWindowTokens: 128000, maxTokens: 8000, reasoning: true, cost: {input: 1}},
        });
    });

    it("Catalog 未命中时保持禁用并列出缺失字段", () => {
        const result = resolveDiscoveredModelDraft(discovered(), null, "openai-completions");
        expect(result.model.enabled).toBe(false);
        expect(result.missingFields).toEqual(expect.arrayContaining(["reasoning", "input", "contextWindowTokens", "maxTokens"]));
    });
});

function discovered(overrides: Partial<DiscoveredProviderModelDto> = {}): DiscoveredProviderModelDto {
    return {id: "model", name: "Model", group: null, api: "openai-completions", reasoning: null, input: null, contextWindowTokens: null, maxTokens: null, cost: null, compat: null, headers: null, thinkingLevelMap: null, ...overrides};
}

function catalog(): ModelCatalogEntryDto {
    return {id: "model", name: "Catalog Model", canonicalSource: "vendor", defaultApi: "openai-completions", reasoning: true, thinkingLevelMap: null, input: ["text"], cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: []}, contextWindowTokens: 128000, maxTokens: 8000, compatByApi: {"openai-completions": null}, headersByApi: {"openai-completions": null}};
}
