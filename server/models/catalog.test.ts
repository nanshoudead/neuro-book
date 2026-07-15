import {describe, expect, it} from "vitest";
import {neuroModelCatalog} from "nbook/server/models/catalog";

describe("NeuroBook Model Catalog", () => {
    it("按精确 model ID 生成唯一且稳定排序的标准条目", () => {
        const catalog = neuroModelCatalog();
        const ids = catalog.models.map((model) => model.id);
        const presetIds = catalog.providerPresets.map((preset) => preset.id);

        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(presetIds).size).toBe(presetIds.length);
        expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)));
        expect(catalog.providerPresets.some((preset) => preset.id === "openai")).toBe(true);
        expect(catalog.providerPresets.some((preset) => preset.id === "custom-openai-completions")).toBe(true);
    });

    it("canonical source 不依赖 Pi 遍历顺序，并保留按 API 的 compat", () => {
        const catalog = neuroModelCatalog();
        expect(catalog.models.find((model) => model.id === "deepseek-v4-pro")?.canonicalSource).toBe("deepseek");
        expect(catalog.models.find((model) => model.id === "mimo-v2.5-pro")).toMatchObject({
            canonicalSource: "xiaomi",
            compatByApi: {
                "openai-completions": expect.objectContaining({maxTokensField: "max_tokens"}),
            },
        });
    });

    it("动态价格哨兵归一化为 null", () => {
        expect(neuroModelCatalog().models.find((model) => model.id === "openrouter/auto")?.cost).toBeNull();
    });

    it("Mimo 按精确 model ID 命中，不依赖本地 Provider ID", () => {
        const model = neuroModelCatalog().models.find((item) => item.id === "mimo-v2.5-pro");
        expect(model).toMatchObject({
            id: "mimo-v2.5-pro",
            defaultApi: "openai-completions",
            contextWindowTokens: 1_048_576,
            maxTokens: 131_072,
        });
    });
});
