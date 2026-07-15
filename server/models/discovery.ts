import {z} from "zod";
import {ProxyAgent} from "undici";
import type {DiscoveredProviderModelDto, ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";

type ProviderFetchInit = RequestInit & {dispatcher?: ProxyAgent};

const OpenAIModelsSchema = z.object({
    data: z.array(z.object({
        id: z.string(),
        name: z.string().optional(),
        context_length: z.number().optional(),
        context_window: z.number().optional(),
        max_context_length: z.number().optional(),
        max_model_len: z.number().optional(),
        max_completion_tokens: z.number().optional(),
        max_output_tokens: z.number().optional(),
        reasoning: z.boolean().optional(),
        supports_reasoning: z.boolean().optional(),
        supported_parameters: z.array(z.string()).optional(),
        input_modalities: z.array(z.string()).optional(),
        architecture: z.object({input_modalities: z.array(z.string()).optional()}).optional(),
        top_provider: z.object({max_completion_tokens: z.number().nullable().optional()}).optional(),
        pricing: z.object({
            prompt: z.string().optional(),
            completion: z.string().optional(),
            input_cache_read: z.string().optional(),
            input_cache_write: z.string().optional(),
        }).optional(),
    }).passthrough()),
});

const GoogleModelsSchema = z.object({
    models: z.array(z.object({
        name: z.string(),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().int().positive().optional(),
        outputTokenLimit: z.number().int().positive().optional(),
        reasoning: z.boolean().optional(),
        supportsReasoning: z.boolean().optional(),
        supportedGenerationMethods: z.array(z.string()).optional(),
    }).passthrough()).default([]),
});

/** 通过 Provider Config 选择的 Adapter 发现并归一化模型列表。 */
export async function discoverProviderModelMetadata(provider: ModelProviderDraftDto): Promise<DiscoveredProviderModelDto[]> {
    if (provider.discovery.adapter === "none") {
        return [];
    }
    const baseURL = provider.options.baseURL.trim();
    if (!baseURL) {
        throw new Error(`${provider.name} 缺少 API Base，无法发现模型。`);
    }
    const payload = await fetchDiscoveryPayload(provider, baseURL);
    if (provider.discovery.adapter === "google-models") {
        return parseGoogleModels(provider, payload);
    }
    return parseOpenAIModels(provider, payload);
}

async function fetchDiscoveryPayload(provider: ModelProviderDraftDto, baseURL: string): Promise<unknown> {
    const timeoutMs = provider.options.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {accept: "application/json"};
    const apiKey = provider.options.apiKey.trim();
    if (apiKey && provider.discovery.adapter !== "google-models") {
        headers.authorization = `Bearer ${apiKey}`;
    }
    const url = new URL(discoveryUrl(baseURL, provider.discovery.endpointPath));
    if (apiKey && provider.discovery.adapter === "google-models") {
        url.searchParams.set("key", apiKey);
        url.searchParams.set("pageSize", "1000");
    }
    try {
        const init: ProviderFetchInit = {
            method: "GET",
            headers,
            signal: controller.signal,
            ...(provider.options.proxy.trim() ? {dispatcher: new ProxyAgent(provider.options.proxy.trim())} : {}),
        };
        const response = await fetch(url, init as RequestInit);
        if (!response.ok) {
            throw new Error(`${provider.name} 模型发现失败：HTTP ${String(response.status)} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`${provider.name} 模型发现请求超时（${String(timeoutMs)}ms）。`);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

function parseOpenAIModels(provider: ModelProviderDraftDto, payload: unknown): DiscoveredProviderModelDto[] {
    const parsed = OpenAIModelsSchema.parse(payload);
    const models = new Map<string, DiscoveredProviderModelDto>();
    for (const item of parsed.data) {
        const id = item.id.trim();
        if (!id || models.has(id)) {
            continue;
        }
        const modalities = item.input_modalities ?? item.architecture?.input_modalities;
        const contextWindowTokens = positiveInteger(item.context_length ?? item.context_window ?? item.max_context_length ?? item.max_model_len);
        const maxTokens = positiveInteger(item.max_completion_tokens ?? item.max_output_tokens ?? item.top_provider?.max_completion_tokens);
        models.set(id, {
            id,
            name: item.name?.trim() || id,
            group: deriveGroup(id),
            api: provider.defaultApi,
            reasoning: item.reasoning ?? item.supports_reasoning ?? (item.supported_parameters ? item.supported_parameters.some((parameter) => parameter === "reasoning" || parameter === "include_reasoning") : null),
            input: modalities ? normalizeModalities(modalities) : null,
            contextWindowTokens,
            maxTokens,
            cost: provider.discovery.adapter === "openrouter-models" ? normalizeOpenRouterCost(item.pricing) : null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
        });
    }
    return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function parseGoogleModels(provider: ModelProviderDraftDto, payload: unknown): DiscoveredProviderModelDto[] {
    const parsed = GoogleModelsSchema.parse(payload);
    return parsed.models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
        .map((model): DiscoveredProviderModelDto => {
            const id = model.name.replace(/^models\//u, "");
            return {
                id,
                name: model.displayName?.trim() || id,
                group: deriveGroup(id),
            api: provider.defaultApi ?? "google-generative-ai",
                reasoning: model.reasoning ?? model.supportsReasoning ?? null,
                input: ["text"],
                contextWindowTokens: model.inputTokenLimit ?? null,
                maxTokens: model.outputTokenLimit ?? null,
                cost: null,
                compat: null,
                headers: null,
                thinkingLevelMap: null,
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
}

function discoveryUrl(baseURL: string, endpointPath: string | null): string {
    const path = endpointPath?.trim() || "/models";
    return `${baseURL.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`;
}

function positiveInteger(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeModalities(values: string[]): Array<"text" | "image"> | null {
    const normalized = [...new Set(values.flatMap((value) => value === "image" ? ["image" as const] : value === "text" ? ["text" as const] : []))];
    return normalized.length ? normalized : null;
}

function normalizeOpenRouterCost(pricing: z.infer<typeof OpenAIModelsSchema>["data"][number]["pricing"]): DiscoveredProviderModelDto["cost"] {
    if (!pricing) {
        return null;
    }
    const input = perTokenPrice(pricing.prompt);
    const output = perTokenPrice(pricing.completion);
    if (input === null || output === null) {
        return null;
    }
    return {
        input,
        output,
        cacheRead: perTokenPrice(pricing.input_cache_read) ?? 0,
        cacheWrite: perTokenPrice(pricing.input_cache_write) ?? 0,
        tiers: [],
    };
}

function perTokenPrice(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function deriveGroup(modelId: string): string {
    const separatorIndex = modelId.search(/[\/:]/u);
    return separatorIndex > 0 ? modelId.slice(0, separatorIndex) : "default";
}
