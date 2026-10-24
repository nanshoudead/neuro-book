import {describe, expect, test} from "bun:test";

import type {MessageView} from "@notnotype/nb-agent-ui";

import {candidateInfos, clampThinking, contextTokensOf, defaultChoice, type CatalogProvider} from "./models";

const model = (id: string, fields: Partial<CatalogProvider["models"][number]> = {}): CatalogProvider["models"][number] => ({id, name: id.toUpperCase(), api: "openai-completions", contextWindow: 200_000, maxTokens: null, reasoning: true, efforts: ["low", "high", "max"], images: false, price: null, ...fields});
const PROVIDERS: CatalogProvider[] = [
    {id: "jiji", name: "jiji", source: "custom", access: "key", keyEnvs: ["JIJI_KEY"], keySet: true, models: [model("gpt-5.6-sol", {images: true})]},
    {id: "deepseek", name: "DeepSeek", source: "catalog", access: "key", keyEnvs: ["DEEPSEEK_API_KEY"], keySet: false, models: [model("deepseek-flash", {contextWindow: 1_000_000})]},
    {id: "anthropic", name: "Anthropic", source: "catalog", access: "login", keyEnvs: [], keySet: false, models: [model("claude-sonnet-5")]},
];

describe("候选模型", () => {
    test("下拉的各项：名称、服务商、图片；密钥没值、要登录、目录里没有的灰掉并写原因", () => {
        const infos = candidateInfos({models: ["jiji/gpt-5.6-sol", "deepseek/deepseek-flash", "anthropic/claude-sonnet-5", "jiji/gone"]}, PROVIDERS);
        expect([...infos.values()].map(info => info.view)).toEqual([
            {key: "jiji/gpt-5.6-sol", label: "GPT-5.6-SOL", supportsImages: true, group: "jiji"},
            {key: "deepseek/deepseek-flash", label: "DEEPSEEK-FLASH", supportsImages: false, group: "DeepSeek", unavailable: "DEEPSEEK_API_KEY 没有值"},
            {key: "anthropic/claude-sonnet-5", label: "CLAUDE-SONNET-5", supportsImages: false, group: "Anthropic", unavailable: "要登录才能用"},
            {key: "jiji/gone", label: "gone", supportsImages: false, group: "jiji", unavailable: "目录里没有这个模型"},
        ]);
        expect(infos.get("deepseek/deepseek-flash")).toMatchObject({contextWindow: 1_000_000, efforts: ["low", "high", "max"]});
    });

    test("推理档往下夹；没有档时不写；比最低档还低取最低档", () => {
        expect(clampThinking(["low", "high", "max"], "medium")).toBe("low");
        expect(clampThinking(["low", "high", "max"], "xhigh")).toBe("high");
        expect(clampThinking(["low", "high"], "minimal")).toBe("low");
        expect(clampThinking([], "high")).toBeNull();
        expect(clampThinking(["low"], null)).toBeNull();
    });

    test("没选过时：新对话用默认模型与它的档；续问接着用上一轮的（还在候选里），档不写", () => {
        const config = {models: ["jiji/gpt-5.6-sol", "deepseek/deepseek-flash"], model: {use: "jiji/gpt-5.6-sol", thinking: "high" as const}};
        expect(defaultChoice(config, null)).toEqual({model: "jiji/gpt-5.6-sol", thinking: "high"});
        expect(defaultChoice(config, "deepseek/deepseek-flash")).toEqual({model: "deepseek/deepseek-flash", thinking: null});
        expect(defaultChoice(config, "qa-model")).toEqual({model: "jiji/gpt-5.6-sol", thinking: "high"});
    });

    test("上下文用量取最近一条带用量的助手消息，含缓存读写", () => {
        const assistant = (id: string, usage?: {input: number; cacheRead: number; cacheWrite: number}): MessageView => ({kind: "assistant", id, timestamp: 0, status: "done", text: "", thinking: "", model: "m", toolCalls: [], contentOmitted: false, ...(usage === undefined ? {} : {usage: {...usage, output: 9, cost: null}})});
        expect(contextTokensOf([assistant("a", {input: 100, cacheRead: 0, cacheWrite: 0}), assistant("b", {input: 20, cacheRead: 3000, cacheWrite: 50}), assistant("c")])).toBe(3070);
        expect(contextTokensOf([])).toBe(0);
    });
});
