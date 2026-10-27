/**
 * 问答配置 → nb-harness 的模型与选项（docs/specs/story/qa.md 的“配置”）。单独成文件：导入 nb-harness 会加载 OMP（它
 * 接管中断信号），只有问答的路径（engine.ts、probe.ts、服务端）才该加载它，读配置的地方（例如 `nbstory ingest`）不该。
 */

import {clampEffort, defineModel, listCatalog, MissingModelKeyError, resolveModel, suggestFromCatalog, supportedEfforts, type HarnessOptions, type ResolvedModel} from "@notnotype/nb-harness";

import {envHas, type KeyEnv} from "../platform/startup-env";
import {parseModelRef, type ConfigCatalog, type Effort, type QaConfig} from "./config";
import {QaError} from "./errors";

/** 这一问选的模型与推理档；不写时用配置的默认模型与它的推理档。 */
export interface QaModelChoice {
    model?: string;
    thinking?: Effort;
}

export interface QaModel {
    readonly resolved: ResolvedModel;
    /** `服务商/模型名`，记进问答记录。 */
    readonly ref: string;
    /** 上下文窗口；不知道时为 null（输入框只显示 token 数）。 */
    readonly contextWindow: number | null;
    /** 能选的推理档；不支持推理或推理档不可控时为空。 */
    readonly efforts: readonly Effort[];
    /** 实际发出的推理档：选的档往下夹到支持的档；不发时为 undefined。 */
    readonly thinking: Effort | undefined;
}

let catalogIndex: ConfigCatalog | undefined;

/** 配置语义校验用的目录查表（见 config.ts 的 `ConfigCatalog`）。 */
export function configCatalog(): ConfigCatalog {
    if (catalogIndex === undefined) {
        const models = new Map(listCatalog().map(provider => [provider.id, new Set(provider.models.map(model => model.id))]));
        catalogIndex = {hasProvider: id => models.has(id), hasModel: (provider, model) => models.get(provider)?.has(model) ?? false};
    }
    return catalogIndex;
}

/**
 * 按引用找模型：自定义服务商的，或 OMP 目录的。引用不在候选里报 `qa_unconfigured`（请求参数的校验在服务端先做，
 * 这里兜底）。不写推理档时，用的是默认模型就用配置的推理档，换了模型就不发。
 */
export function resolveQaModel(config: QaConfig, choice: QaModelChoice = {}): QaModel {
    const ref = choice.model ?? config.model.use;
    if (!config.models.includes(ref)) throw new QaError("qa_unconfigured", `模型 ${ref} 不在候选模型里`);
    const requested = choice.thinking ?? (ref === config.model.use ? config.model.thinking : undefined);
    const resolved = modelOf(config, ref);
    const efforts = supportedEfforts(resolved.model);
    return {resolved, ref, contextWindow: resolved.model.contextWindow ?? null, efforts, thinking: clampEffort(resolved.model, requested)};
}

/** 自定义服务商的模型没写 `maxTokens`、目录里也查不到同名模型时的输出上限。 */
export const DEFAULT_CUSTOM_MAX_TOKENS = 32_768;

/**
 * 引用指向的模型，不看在不在候选里（设置页要列出自定义服务商的全部模型）。自定义服务商的模型：没写的上下文、最大
 * 输出、推理与图片按模型名从 OMP 目录补（同 OMP 的 `finalizeCustomModel`），单价不补。provider 名用自定义服务商的 id：
 * 它不与目录重名，OMP 按通用的兼容端点处理。
 */
export function modelOf(config: QaConfig, ref: string): ResolvedModel {
    const {provider: providerId, model: modelId} = parseModelRef(ref);
    const provider = config.providers?.[providerId];
    if (provider === undefined) {
        try {
            return resolveModel(ref);
        } catch (error) {
            throw new QaError("qa_unconfigured", `模型 ${ref}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
        }
    }
    const model = provider.models.find(item => item.id === modelId);
    if (model === undefined) throw new QaError("qa_unconfigured", `模型 ${ref}：自定义服务商 ${providerId} 里没有模型 ${modelId}`);
    const suggested = suggestFromCatalog(modelId);
    const contextWindow = model.contextWindow ?? suggested?.contextWindow ?? null;
    // 不写输出上限时，请求里就没有这个字段，网关按自己的默认预算（常常把隐藏思考也算进去）截断长回答，记录还显示正常结束。
    // 默认取 OMP 对 OpenAI 兼容端点的发现默认值 32768；OpenAI 系请求发出前由 pi-ai 夹到 64000。
    const maxTokens = model.maxTokens ?? suggested?.maxTokens ?? DEFAULT_CUSTOM_MAX_TOKENS;
    return defineModel({
        provider: providerId,
        api: provider.api,
        baseUrl: provider.baseUrl,
        id: modelId,
        ...(model.name === undefined ? {} : {name: model.name}),
        apiKeyEnv: provider.apiKeyEnv,
        reasoning: model.reasoning ?? suggested?.reasoning ?? false,
        input: (model.images ?? suggested?.images ?? false) ? ["text", "image"] : ["text"],
        contextWindow,
        maxTokens,
        ...(model.price === undefined ? {} : {price: model.price}),
    });
}

/** 这个模型认的密钥变量：自定义服务商是它的 `apiKeyEnv`，目录服务商是目录登记的（不要密钥的服务商为空）。 */
export function keyVariables(config: QaConfig, ref: string): readonly string[] {
    const {provider: providerId} = parseModelRef(ref);
    const custom = config.providers?.[providerId];
    if (custom !== undefined) return [custom.apiKeyEnv];
    return listCatalog().find(item => item.id === providerId)?.keyEnvs ?? [];
}

/**
 * 只认 `env` 里的密钥（docs/adr/0032）：`env` 里这个模型认的变量一个都没有值时，取密钥按缺失处理（harness 在发请求前
 * 归为 `auth`）；有值时取值仍交给原来的函数。OMP 导入时读进 `process.env` 的 `.env` 因此不算。
 */
export function onlyKeysIn(resolved: ResolvedModel, variables: readonly string[], env: KeyEnv): ResolvedModel {
    if (variables.length === 0) return resolved;
    const inner = resolved.apiKey;
    return {...resolved, apiKey: () => {
        if (!variables.some(name => envHas(env, name))) throw new MissingModelKeyError(variables);
        return inner();
    }};
}

/** 实际发出的推理档 → `createHarness` 的选项；不发就不传，请求里没有推理参数。 */
export function thinkingOption(model: QaModel): Pick<HarnessOptions, "thinkingLevel"> {
    return model.thinking === undefined ? {} : {thinkingLevel: model.thinking};
}
