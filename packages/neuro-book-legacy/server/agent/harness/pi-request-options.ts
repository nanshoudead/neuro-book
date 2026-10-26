import type {Api, ProviderHeaders, SimpleStreamOptions} from "@earendil-works/pi-ai";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {
    DEFAULT_VERTEX_LOCATION,
    VERTEX_ADC_API_KEY,
    defaultVertexCredentialsDirectory,
    readVertexServiceAccount,
    writeVertexServiceAccountFile,
} from "nbook/server/models/vertex-credentials";
import {
    parsePiMaxRetries,
    PiSimpleRequestOptionsSchema,
    type PiSimpleRequestOptionsDto,
} from "nbook/shared/dto/pi-request-options.dto";

const OPENAI_NO_AUTH_KEY = "neurobook-no-auth";

/**
 * 校验并复制 Provider requestOptions。
 *
 * 返回值只包含 Pi `streamSimple` 已确认会生效的 JSON-safe 字段；runtime
 * 自己负责附加 API key、signal、reasoning、timeout、session 和观测回调。
 */
export function parsePiSimpleRequestOptions(
    requestOptions: Record<string, JsonValue> | undefined,
): PiSimpleRequestOptionsDto & {maxRetries: number} {
    const parsed = PiSimpleRequestOptionsSchema.parse(requestOptions ?? {});
    return {
        ...parsed,
        maxRetries: parsePiMaxRetries(parsed.maxRetries),
    };
}

/**
 * 为当前 API 合并 NeuroBook secret 与 Provider-scoped env。
 *
 * Bedrock 的 bearer token 通过 Pi 正式读取的 AWS env 传入；Vertex 的服务账号 JSON
 * 落成凭据文件后走 ADC；其他 API 使用标准 `apiKey`。所有 Provider 都是用户独立
 * runtime；OpenAI-compatible 空 key 使用内部占位值，以兼容无认证端点。
 */
export function piRequestAuthOptions(input: {
    api: Api;
    apiKey?: string;
    env?: Record<string, string>;
    /** 测试注入。缺省写到系统临时目录。 */
    vertexCredentialsDirectory?: string;
}): Pick<SimpleStreamOptions, "apiKey" | "env"> {
    if (input.api === "bedrock-converse-stream") {
        return {
            ...(input.apiKey
                ? {env: {...input.env, AWS_BEARER_TOKEN_BEDROCK: input.apiKey}}
                : input.env ? {env: input.env} : {}),
        };
    }
    if (input.api === "google-vertex") {
        return vertexAuthOptions(input);
    }
    if (input.apiKey) {
        return {apiKey: input.apiKey, ...(input.env ? {env: input.env} : {})};
    }
    if (input.api === "openai-completions" || input.api === "openai-responses") {
        return {apiKey: OPENAI_NO_AUTH_KEY, ...(input.env ? {env: input.env} : {})};
    }
    return input.env ? {env: input.env} : {};
}

/**
 * 服务账号 JSON 落成凭据文件，再让 Pi 走 ADC。
 * 普通字符串仍是 Vertex API key。已有的 env 优先于 JSON 里的项目和默认区域。
 */
function vertexAuthOptions(input: {
    apiKey?: string;
    env?: Record<string, string>;
    vertexCredentialsDirectory?: string;
}): Pick<SimpleStreamOptions, "apiKey" | "env"> {
    const apiKey = input.apiKey?.trim() ?? "";
    const account = apiKey ? readVertexServiceAccount(apiKey) : null;
    if (!account) {
        if (apiKey) {
            return {apiKey, ...(input.env ? {env: input.env} : {})};
        }
        return input.env ? {env: input.env} : {};
    }
    const credentialsPath = writeVertexServiceAccountFile(
        account,
        input.vertexCredentialsDirectory ?? defaultVertexCredentialsDirectory(),
    );
    return {
        apiKey: VERTEX_ADC_API_KEY,
        env: {
            ...input.env,
            GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
            GOOGLE_CLOUD_PROJECT: input.env?.GOOGLE_CLOUD_PROJECT || account.projectId,
            GOOGLE_CLOUD_LOCATION: input.env?.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION,
        },
    };
}

/**
 * 合并 model 默认 headers 与请求覆盖；请求值优先，null 可显式移除默认 header。
 */
export function mergePiRequestHeaders(
    modelHeaders: ProviderHeaders | undefined,
    requestHeaders: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
    if (!modelHeaders && !requestHeaders) {
        return undefined;
    }
    return {...modelHeaders, ...requestHeaders};
}
