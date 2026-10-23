/**
 * 问答配置 → nb-harness 的模型与选项。单独成文件：导入 nb-harness 会加载 OMP（它接管中断信号），只有问答的路径
 * （engine.ts、probe.ts）才该加载它，读配置的地方（例如 `nbstory ingest`）不该。
 */

import {defineModel, type HarnessOptions, type ResolvedModel} from "@notnotype/nb-harness";

import type {QaConfig} from "./config";

/**
 * 配置里的模型 → nb-harness 的模型。provider 名用 `nbstory`：不是 OMP 目录里的 provider，OMP 按通用的 OpenAI
 * 兼容端点处理（system 角色、不带厂商私有参数），适合任意兼容服务。
 *
 * 接口缺省是 Chat Completions。GPT 系列经它不回思考内容；选 Responses 时 OMP 在请求里要思考摘要
 * （`reasoning.summary: "auto"`），摘要作为思考块进会话日志。
 */
export function configuredModel(config: QaConfig): ResolvedModel {
    const {model} = config;
    return defineModel({
        provider: "nbstory",
        api: model.api === "responses" ? "openai-responses" : "openai-completions",
        baseUrl: model.baseUrl,
        id: model.id,
        apiKeyEnv: model.apiKeyEnv,
        reasoning: model.thinking !== undefined,
        ...(model.contextWindow === undefined ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxTokens === undefined ? {} : {maxTokens: model.maxTokens}),
        ...(model.price === undefined ? {} : {price: model.price}),
    });
}

/** 配置的推理档 → `createHarness` 的选项；OMP 的思考档是字符串值的 const enum（"low"、"medium"、"high" 等），配置里的字符串就是它的值。不写就不传，请求里没有推理档。 */
export function thinkingOption(config: QaConfig): Pick<HarnessOptions, "thinkingLevel"> {
    return config.model.thinking === undefined ? {} : {thinkingLevel: config.model.thinking as NonNullable<HarnessOptions["thinkingLevel"]>};
}
