import type {Api, Model} from "@earendil-works/pi-ai";
import type {ConfiguredModelConfig, ConfiguredProviderConfig} from "nbook/server/config/types";
import {resolvePiRuntimeCost} from "nbook/server/utils/pi-model-cost";
import {SupportedPiApiSchema} from "nbook/shared/dto/app-settings.dto";
import {assertConfiguredModel} from "nbook/server/models/model-config-validation";

export type ResolvedPiModel = Model<Api> & {
    /** Session selection 使用的本地 Provider Config ID。 */
    providerConfigId: string;
};

/**
 * 将完整、自包含的用户 Provider Config 解析为 Pi Model。
 * Runtime 不读取 Provider Preset、Model Catalog 或远程发现结果，也不猜测任何必需能力。
 */
export function resolvePiModelMetadata(
    providerConfigId: string,
    provider: ConfiguredProviderConfig,
    model: ConfiguredModelConfig,
): ResolvedPiModel {
    assertConfiguredModel(providerConfigId, provider, model);
    const api = SupportedPiApiSchema.parse(model.api);
    const baseUrl = api === "google-vertex"
        ? vertexCollectionBaseUrl(provider.options.baseURL)
        : provider.options.baseURL.trim();

    return {
        id: model.id,
        name: model.name || model.id,
        api,
        provider: providerConfigId,
        providerConfigId,
        baseUrl,
        reasoning: model.reasoning,
        input: [...model.input],
        cost: resolvePiRuntimeCost(undefined, model.cost),
        contextWindow: model.contextWindowTokens,
        maxTokens: model.maxTokens,
        headers: Object.fromEntries(Object.entries(model.headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)),
        ...(model.compat ? {compat: model.compat as Model<Api>["compat"]} : {}),
        ...(model.thinkingLevelMap ? {thinkingLevelMap: model.thinkingLevelMap} : {}),
    };
}

/**
 * Pi 把不含 `{location}` 的 baseUrl 当成自定义集合根，并不再插入 `projects/{project}`。
 * 只写了 `aiplatform.googleapis.com` 主机时，服务账号 JSON 里的项目进不了地址，
 * Google 返回 RESOURCE_PROJECT_INVALID。这种地址留空，让 Pi 用项目和区域自己拼。
 * 路径已经停在 `projects/.../locations/...` 的地址是调用方指定的集合根，原样保留。
 */
function vertexCollectionBaseUrl(baseURL: string): string {
    const trimmed = baseURL.trim();
    if (!trimmed) {
        return "";
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return trimmed;
    }
    const host = url.hostname.toLowerCase();
    const vertexHost = host === "aiplatform.googleapis.com" || host.endsWith("-aiplatform.googleapis.com");
    if (!vertexHost) {
        return trimmed;
    }
    const path = url.pathname.replace(/\/+$/u, "");
    if (/\/projects\/[^/]+\/locations\/[^/]+$/u.test(path)) {
        return trimmed;
    }
    return "";
}
