import type {Api, Model} from "@earendil-works/pi-ai";
import {builtinProviders} from "@earendil-works/pi-ai/providers/all";
import {normalizePiRegistryCost} from "nbook/server/utils/pi-model-cost";
import {
    NeuroModelCatalogDtoSchema,
    type ModelCatalogEntryDto,
    type NeuroModelCatalogDto,
    type ProviderDiscoveryAdapterDto,
    type ProviderPresetDto,
} from "nbook/shared/dto/app-settings.dto";
import {isSupportedPiApi, type SupportedPiApi} from "nbook/shared/models/provider-config-contract";

const PROVIDER_SOURCE_PRIORITY = [
    "anthropic", "openai", "google", "deepseek", "xai", "xiaomi", "mistral", "minimax", "minimax-cn",
    "moonshotai", "moonshotai-cn", "zai", "zai-coding-cn", "kimi-coding", "cerebras", "groq", "nvidia",
    "amazon-bedrock", "google-vertex", "azure-openai-responses", "fireworks", "together", "huggingface",
    "openrouter", "vercel-ai-gateway", "cloudflare-ai-gateway", "cloudflare-workers-ai", "github-copilot",
    "opencode", "opencode-go", "ant-ling", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp",
] as const;

const OPENAI_DISCOVERY_PROVIDERS = new Set([
    "openai", "deepseek", "xai", "groq", "cerebras", "fireworks", "together", "nvidia", "mistral",
    "moonshotai", "moonshotai-cn", "minimax", "minimax-cn", "zai", "zai-coding-cn", "kimi-coding",
    "xiaomi", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp",
]);

const MODEL_API_COMPAT_PATCHES: Readonly<Record<string, Partial<Record<SupportedPiApi, Record<string, unknown>>>>> = {
    "mimo-v2.5-pro": {
        "openai-completions": {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
        },
    },
};

let cachedCatalog: NeuroModelCatalogDto | null = null;

/** 返回进程级只读 NeuroBook Provider Preset 与唯一标准 Model Catalog。 */
export function neuroModelCatalog(): NeuroModelCatalogDto {
    cachedCatalog ??= NeuroModelCatalogDtoSchema.parse(buildCatalog());
    return cachedCatalog;
}

/** 按精确 model ID 查询唯一标准模型。 */
export function catalogModel(modelId: string): ModelCatalogEntryDto | null {
    return neuroModelCatalog().models.find((model) => model.id === modelId) ?? null;
}

function buildCatalog(): NeuroModelCatalogDto {
    const providers = [...builtinProviders()].sort(compareProviderSource);
    const candidates = new Map<string, Array<{providerId: string; model: Model<Api>}>>();

    for (const provider of providers) {
        for (const model of provider.getModels()) {
            if (!isSupportedPiApi(model.api)) {
                continue;
            }
            const entries = candidates.get(model.id) ?? [];
            entries.push({providerId: provider.id, model});
            candidates.set(model.id, entries);
        }
    }

    return {
        providerPresets: [
            ...providers.flatMap(providerPreset),
            ...customProviderPresets(),
        ],
        models: [...candidates.entries()]
            .map(([modelId, entries]) => buildModelEntry(modelId, entries.sort((left, right) => compareProviderSource(left.providerId, right.providerId))))
            .sort((left, right) => left.id.localeCompare(right.id)),
    };
}

function buildModelEntry(modelId: string, entries: Array<{providerId: string; model: Model<Api>}>): ModelCatalogEntryDto {
    const canonical = entries[0];
    if (!canonical || !isSupportedPiApi(canonical.model.api)) {
        throw new Error(`Model Catalog 缺少可支持的 canonical model：${modelId}`);
    }
    const compatByApi: ModelCatalogEntryDto["compatByApi"] = {};
    const headersByApi: ModelCatalogEntryDto["headersByApi"] = {};
    for (const entry of entries) {
        if (!isSupportedPiApi(entry.model.api)) {
            continue;
        }
        if (!(entry.model.api in compatByApi)) {
            const patch = MODEL_API_COMPAT_PATCHES[modelId]?.[entry.model.api];
            const compat = {...(entry.model.compat ?? {}), ...(patch ?? {})};
            // Pi compat 包含具名接口对象；Catalog DTO 会在出口用 Zod 重新验证其 JSON 可序列化形态。
            compatByApi[entry.model.api] = Object.keys(compat).length
                ? compat as unknown as ModelCatalogEntryDto["compatByApi"][string]
                : null;
        }
        if (!(entry.model.api in headersByApi)) {
            headersByApi[entry.model.api] = entry.model.headers && Object.keys(entry.model.headers).length
                ? {...entry.model.headers}
                : null;
        }
    }
    return {
        id: canonical.model.id,
        name: canonical.model.name,
        canonicalSource: canonical.providerId,
        defaultApi: canonical.model.api,
        reasoning: canonical.model.reasoning,
        thinkingLevelMap: canonical.model.thinkingLevelMap ? {...canonical.model.thinkingLevelMap} : null,
        input: [...canonical.model.input],
        cost: normalizePiRegistryCost(canonical.model.cost),
        contextWindowTokens: canonical.model.contextWindow,
        maxTokens: canonical.model.maxTokens,
        compatByApi,
        headersByApi,
    };
}

function providerPreset(provider: ReturnType<typeof builtinProviders>[number]): ProviderPresetDto[] {
    const apis = [...new Set(provider.getModels().map((model) => model.api).filter(isSupportedPiApi))].sort();
    if (!apis.length) {
        return [];
    }
    const counts = new Map<SupportedPiApi, number>();
    for (const model of provider.getModels()) {
        if (isSupportedPiApi(model.api)) {
            counts.set(model.api, (counts.get(model.api) ?? 0) + 1);
        }
    }
    const defaultApi = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    return [{
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl ?? "",
        supportedApis: apis,
        defaultApi,
        discovery: {
            adapter: discoveryAdapter(provider.id, apis),
            endpointPath: null,
        },
    }];
}

function customProviderPresets(): ProviderPresetDto[] {
    const entries: Array<{api: SupportedPiApi; discovery: ProviderDiscoveryAdapterDto}> = [
        {api: "openai-completions", discovery: "openai-models"},
        {api: "openai-responses", discovery: "openai-models"},
        {api: "anthropic-messages", discovery: "none"},
        {api: "google-generative-ai", discovery: "google-models"},
        {api: "bedrock-converse-stream", discovery: "none"},
    ];
    return entries.map(({api, discovery}) => ({
        id: `custom-${api}`,
        name: `Custom ${api}`,
        baseUrl: "",
        supportedApis: [api],
        defaultApi: api,
        discovery: {adapter: discovery, endpointPath: null},
    }));
}

function discoveryAdapter(providerId: string, apis: SupportedPiApi[]): ProviderDiscoveryAdapterDto {
    if (providerId === "openrouter") {
        return "openrouter-models";
    }
    if (providerId === "google") {
        return "google-models";
    }
    if (OPENAI_DISCOVERY_PROVIDERS.has(providerId) || apis.every((api) => api === "openai-completions" || api === "openai-responses")) {
        return "openai-models";
    }
    return "none";
}

function compareProviderSource(left: {id: string} | string, right: {id: string} | string): number {
    const leftId = typeof left === "string" ? left : left.id;
    const rightId = typeof right === "string" ? right : right.id;
    const leftIndex = PROVIDER_SOURCE_PRIORITY.indexOf(leftId as typeof PROVIDER_SOURCE_PRIORITY[number]);
    const rightIndex = PROVIDER_SOURCE_PRIORITY.indexOf(rightId as typeof PROVIDER_SOURCE_PRIORITY[number]);
    const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || leftId.localeCompare(rightId);
}
