import {describe, expect, test} from "bun:test";

import {compareModels, hitCounts, orderCatalog, orderProviders, providerSelectable, searchCatalog, type CatalogModelView, type CatalogProviderView} from "./model-catalog";

const model = (id: string, name = id): CatalogModelView => ({id, name, api: "openai-completions", contextWindow: null, reasoning: false, images: false, price: null});
const provider = (id: string, fields: Partial<CatalogProviderView> = {}): CatalogProviderView => ({id, name: id, source: "catalog", access: "key", keyEnvs: [], keySet: false, models: [], ...fields});

describe("服务商", () => {
    test("能不能选：自定义、key、keyless 能选；login 有值才能选；unsupported 不能选", () => {
        expect(providerSelectable(provider("a"))).toBe(true);
        expect(providerSelectable(provider("a", {access: "keyless"}))).toBe(true);
        expect(providerSelectable(provider("a", {access: "login"}))).toBe(false);
        expect(providerSelectable(provider("a", {access: "login", keySet: true}))).toBe(true);
        expect(providerSelectable(provider("a", {access: "unsupported"}))).toBe(false);
        expect(providerSelectable(provider("a", {source: "custom", access: "unsupported"}))).toBe(true);
    });

    test("左栏顺序：自定义、有值的在前，其余保持原顺序；用不了的单列", () => {
        const {usable, locked} = orderProviders([provider("b"), provider("c", {keySet: true}), provider("d", {access: "login"}), provider("e", {source: "custom"}), provider("f")]);
        expect(usable.map(item => item.id)).toEqual(["e", "c", "b", "f"]);
        expect(locked.map(item => item.id)).toEqual(["d"]);
    });
});

describe("模型的默认顺序与搜索", () => {
    test("同一系列版本号新的在前，系列按名字", () => {
        const ids = ["gpt-4", "claude-sonnet-4.6", "gpt-5.6-sol", "claude-sonnet-5", "gpt-4.1"].map(id => model(id)).sort(compareModels).map(item => item.id);
        expect(ids).toEqual(["claude-sonnet-5", "claude-sonnet-4.6", "gpt-5.6-sol", "gpt-4.1", "gpt-4"]);
    });

    const providers = [
        provider("openai", {models: [model("gpt-5.6-sol", "GPT-5.6 Sol"), model("gpt-4")]}),
        provider("openrouter", {models: [model("openai/gpt-5.6-sol"), model("anthropic/claude-sonnet-5")]}),
        provider("anthropic", {access: "login", models: [model("claude-sonnet-5", "Claude Sonnet 5")]}),
    ];
    const catalog = orderCatalog(providers);

    test("三层：精确在前，然后连续子串，然后模糊；同层能选的服务商在前", () => {
        const hits = searchCatalog(catalog, "gpt-5.6-sol");
        expect(hits.map(hit => [hit.ref, hit.tier])).toEqual([["openai/gpt-5.6-sol", 0], ["openrouter/openai/gpt-5.6-sol", 1]]);
        const sonnet = searchCatalog(catalog, "sonnet");
        // anthropic 用不了，同层排在后面。
        expect(sonnet.map(hit => hit.ref)).toEqual(["openrouter/anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5"]);
        const fuzzy = searchCatalog(catalog, "gpt56");
        expect(fuzzy.map(hit => [hit.ref, hit.tier])).toEqual([["openai/gpt-5.6-sol", 2], ["openrouter/openai/gpt-5.6-sol", 2]]);
        // 显示名也算，大小写不分。
        expect(searchCatalog(catalog, "Claude Sonnet").map(hit => hit.ref)).toEqual(["anthropic/claude-sonnet-5"]);
        expect(searchCatalog(catalog, "不存在")).toEqual([]);
    });

    test("查询为空是全部模型的默认顺序；命中数按服务商数", () => {
        const all = searchCatalog(catalog, "  ");
        expect(all.map(hit => hit.ref)).toEqual(["openai/gpt-5.6-sol", "openai/gpt-4", "openrouter/anthropic/claude-sonnet-5", "openrouter/openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"]);
        expect([...hitCounts(searchCatalog(catalog, "gpt")).entries()]).toEqual([["openai", 2], ["openrouter", 1]]);
    });
});
