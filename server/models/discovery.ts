import {z} from "zod";
import {ProxyAgent} from "undici";
import type {DiscoveredProviderModelDto, ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";
import {deriveModelGroup} from "nbook/shared/models/model-group";

type ProviderFetchInit = RequestInit & {dispatcher?: ProxyAgent};
type DiscoveryAdapterId = "openai-models" | "openrouter-models" | "google-models";
type DiscoveryAdapter = {
    id: DiscoveryAdapterId;
    url(provider: ModelProviderDraftDto, baseURL: URL): URL;
    headers(provider: ModelProviderDraftDto): Record<string, string>;
    parse(payload: unknown): DiscoveredProviderModelDto[];
};

const MAX_DISCOVERY_RESPONSE_BYTES = 5 * 1024 * 1024;

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

const openAiAdapter: DiscoveryAdapter = {
    id: "openai-models",
    url: (_provider, baseURL) => modelsUrl(baseURL),
    headers: bearerHeaders,
    parse: (payload) => parseOpenAIModels(payload, false, null),
};

const openRouterAdapter: DiscoveryAdapter = {
    id: "openrouter-models",
    url: (_provider, baseURL) => modelsUrl(baseURL),
    headers: bearerHeaders,
    parse: (payload) => parseOpenAIModels(payload, true, "openai-completions"),
};

const googleAdapter: DiscoveryAdapter = {
    id: "google-models",
    url: (provider, baseURL) => {
        const url = modelsUrl(baseURL);
        const apiKey = provider.options.apiKey.trim();
        if (apiKey) {
            url.searchParams.set("key", apiKey);
        }
        url.searchParams.set("pageSize", "1000");
        return url;
    },
    headers: () => ({accept: "application/json"}),
    parse: parseGoogleModels,
};

/**
 * 自动发现当前 Provider 的模型。
 * Adapter 选择、路径、鉴权与响应归一化全部隐藏在本 Module 内部。
 */
export async function discoverProviderModelMetadata(provider: ModelProviderDraftDto): Promise<DiscoveredProviderModelDto[]> {
    const baseUrlText = provider.options.baseURL.trim();
    if (!baseUrlText) {
        throw new Error(`${provider.name} 缺少 API Base，无法发现模型。`);
    }

    let baseURL: URL;
    try {
        baseURL = new URL(baseUrlText);
    } catch {
        throw new Error(`${provider.name} 的 API Base 不是有效 URL。`);
    }

    const adapters = orderedAdapters(provider, baseURL);
    if (adapters.length === 0) {
        throw new Error(`${provider.name} 当前配置的模型 API 不支持自动发现，请从 Model Library 添加或手动配置模型。`);
    }

    const attempts: string[] = [];
    for (const adapter of adapters) {
        try {
            const models = await runAdapter(provider, baseURL, adapter);
            if (models.length > 0) {
                return models;
            }
            attempts.push(`${adapter.id}: empty`);
        } catch (error) {
            attempts.push(`${adapter.id}: ${safeAttemptMessage(error)}`);
        }
    }

    throw new Error(`${provider.name} 未发现可用模型。尝试结果：${attempts.join("；")}`);
}

async function runAdapter(provider: ModelProviderDraftDto, baseURL: URL, adapter: DiscoveryAdapter): Promise<DiscoveredProviderModelDto[]> {
    const timeoutMs = provider.options.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const url = adapter.url(provider, baseURL);
    if (url.origin !== baseURL.origin) {
        throw new Error("目标 origin 与 API Base 不一致");
    }

    const proxyUrl = provider.options.proxy.trim();
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    try {
        const init: ProviderFetchInit = {
            method: "GET",
            headers: adapter.headers(provider),
            redirect: "error",
            signal: controller.signal,
            ...(dispatcher ? {dispatcher} : {}),
        };
        const response = await fetch(url, init as RequestInit);
        if (!response.ok) {
            throw new Error(`HTTP ${String(response.status)}`);
        }
        return adapter.parse(await readJson(response));
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`请求超时（${String(timeoutMs)}ms）`);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}

/**
 * 按连接已知协议选择发现 Adapter。
 *
 * 不对未知 Provider 轮换鉴权形式：API Key 不能因为响应格式不匹配，
 * 从 Bearer Header 改写到查询参数或发送给另一套协议。
 */
function orderedAdapters(provider: ModelProviderDraftDto, baseURL: URL): DiscoveryAdapter[] {
    const host = baseURL.hostname.toLowerCase();
    if (host.includes("openrouter")) {
        return [openRouterAdapter];
    }
    if (host.includes("googleapis.com") || provider.modelApi === "google-generative-ai") {
        return [googleAdapter];
    }
    if (provider.modelApi === "anthropic-messages" || provider.modelApi === "bedrock-converse-stream") {
        return [];
    }
    return [openAiAdapter];
}

function modelsUrl(baseURL: URL): URL {
    const url = new URL(baseURL.toString());
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/models`;
    url.search = "";
    return url;
}

function bearerHeaders(provider: ModelProviderDraftDto): Record<string, string> {
    const headers: Record<string, string> = {accept: "application/json"};
    const apiKey = provider.options.apiKey.trim();
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

async function readJson(response: Response): Promise<unknown> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DISCOVERY_RESPONSE_BYTES) {
        throw new Error("响应体过大");
    }
    return JSON.parse(await readResponseText(response)) as unknown;
}

/** 在读取过程中执行硬字节上限，避免未知 Content-Length 的响应占满内存。 */
async function readResponseText(response: Response): Promise<string> {
    if (!response.body) {
        return "";
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            totalBytes += chunk.value.byteLength;
            if (totalBytes > MAX_DISCOVERY_RESPONSE_BYTES) {
                await reader.cancel("响应体过大");
                throw new Error("响应体过大");
            }
            chunks.push(chunk.value);
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function parseOpenAIModels(
    payload: unknown,
    includePricing: boolean,
    api: DiscoveredProviderModelDto["api"],
): DiscoveredProviderModelDto[] {
    const parsed = OpenAIModelsSchema.parse(payload);
    const models = new Map<string, DiscoveredProviderModelDto>();
    for (const item of parsed.data) {
        const id = item.id.trim();
        if (!id || models.has(id)) {
            continue;
        }
        const modalities = item.input_modalities ?? item.architecture?.input_modalities;
        models.set(id, {
            id,
            name: item.name?.trim() || id,
            group: deriveModelGroup(id),
            api,
            reasoning: item.reasoning ?? item.supports_reasoning ?? (item.supported_parameters ? item.supported_parameters.some((parameter) => parameter === "reasoning" || parameter === "include_reasoning") : null),
            input: modalities ? normalizeModalities(modalities) : null,
            contextWindowTokens: positiveInteger(item.context_length ?? item.context_window ?? item.max_context_length ?? item.max_model_len),
            maxTokens: positiveInteger(item.max_completion_tokens ?? item.max_output_tokens ?? item.top_provider?.max_completion_tokens),
            cost: includePricing ? normalizeOpenRouterCost(item.pricing) : null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
        });
    }
    return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function parseGoogleModels(payload: unknown): DiscoveredProviderModelDto[] {
    const parsed = GoogleModelsSchema.parse(payload);
    return parsed.models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
        .map((model): DiscoveredProviderModelDto => {
            const id = model.name.replace(/^models\//u, "");
            return {
                id,
                name: model.displayName?.trim() || id,
                group: deriveModelGroup(id),
                api: "google-generative-ai",
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

function safeAttemptMessage(error: unknown): string {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return "响应格式不匹配";
    }
    const message = error instanceof Error ? error.message : "未知错误";
    return message.replace(/https?:\/\/\S+/giu, "[URL]").slice(0, 160);
}
