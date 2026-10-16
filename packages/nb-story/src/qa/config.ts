/**
 * 问答的配置文件（docs/specs/story/qa.md 的“配置”）。只有 `nbstory ask` 读它；密钥本身不在这里，只写存密钥的
 * 环境变量名。
 */

import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

import {defineModel, type ResolvedModel} from "@notnotype/nb-harness";
import {Type, type Static} from "typebox";
import {Compile} from "typebox/compile";

import {QaError} from "./errors";

const ConfigSchema = Type.Object({
    model: Type.Object({
        baseUrl: Type.String({minLength: 1}),
        id: Type.String({minLength: 1}),
        apiKeyEnv: Type.String({minLength: 1}),
        contextWindow: Type.Optional(Type.Integer({minimum: 1})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1})),
        thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")])),
        price: Type.Optional(
            Type.Object({
                input: Type.Number({minimum: 0}),
                output: Type.Number({minimum: 0}),
                cacheRead: Type.Optional(Type.Number({minimum: 0})),
                currency: Type.String({minLength: 1}),
            }),
        ),
    }),
    qa: Type.Optional(
        Type.Object({
            maxChapters: Type.Optional(Type.Integer({minimum: 1, maximum: 20})),
            fullReadMaxChars: Type.Optional(Type.Integer({minimum: 1})),
        }),
    ),
});

export type QaConfig = Static<typeof ConfigSchema>;

/** 图当目录一问最多读的不同章数（开发者定的上限，配置只能调小）。 */
export const MAX_CHAPTERS = 20;
export const DEFAULT_FULL_READ_MAX_CHARS = 300_000;

const checkConfig = Compile(ConfigSchema);

/** 配置文件的默认位置：`$XDG_CONFIG_HOME/nbstory/config.json`，未设置时 `~/.config/nbstory/config.json`。 */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nbstory", "config.json");
}

/** 读并校验配置；文件不在、不是 JSON 或字段不对都报 `qa_unconfigured`，写明是哪个字段。 */
export async function loadQaConfig(path: string = defaultConfigPath()): Promise<QaConfig> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        throw new QaError("qa_unconfigured", `读不到问答配置 ${path}：先按 docs/specs/story/qa.md 的“配置”写好它`, {cause: error});
    }
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new QaError("qa_unconfigured", `问答配置 ${path} 不是 JSON`, {cause: error});
    }
    if (!checkConfig.Check(value)) {
        const problems = [...checkConfig.Errors(value)].slice(0, 3).map(item => `${item.instancePath || "/"} ${item.message}`);
        throw new QaError("qa_unconfigured", `问答配置 ${path} 不对：${problems.join("；")}`);
    }
    return value;
}

/**
 * 配置里的模型 → nb-harness 的模型。provider 名用 `nbstory`：不是 OMP 目录里的 provider，OMP 按通用的 OpenAI
 * 兼容端点处理（system 角色、不带厂商私有参数），适合任意兼容服务。
 */
export function configuredModel(config: QaConfig): ResolvedModel {
    const {model} = config;
    return defineModel({
        provider: "nbstory",
        api: "openai-completions",
        baseUrl: model.baseUrl,
        id: model.id,
        apiKeyEnv: model.apiKeyEnv,
        reasoning: model.thinking !== undefined,
        ...(model.contextWindow === undefined ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxTokens === undefined ? {} : {maxTokens: model.maxTokens}),
        ...(model.price === undefined ? {} : {price: model.price}),
    });
}

export function qaLimits(config: QaConfig): {maxChapters: number; fullReadMaxChars: number} {
    return {maxChapters: config.qa?.maxChapters ?? MAX_CHAPTERS, fullReadMaxChars: config.qa?.fullReadMaxChars ?? DEFAULT_FULL_READ_MAX_CHARS};
}
