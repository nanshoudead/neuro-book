/**
 * 问答与抽取共用的配置文件（docs/specs/story/qa.md 的“配置”、docs/specs/story/ingest.md 的“抽取模型”）。密钥本身
 * 不在这里，只写存密钥的环境变量名。
 *
 * 这里不导入 nb-harness：它一被导入，OMP 就接管中断信号（`nbstory ingest` 要自己处理 Ctrl-C）。配置到 nb-harness
 * 模型的转换在 harness-model.ts。
 */

import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join} from "node:path";

import {Type, type Static} from "typebox";
import {Compile} from "typebox/compile";

import {QaError} from "./errors";

const PriceSchema = Type.Object({
    input: Type.Number({minimum: 0}),
    output: Type.Number({minimum: 0}),
    cacheRead: Type.Optional(Type.Number({minimum: 0})),
    currency: Type.String({minLength: 1}),
});

/** 抽取用的一个模型。推理档由程序按步骤固定，所以不收 `thinking`（写了就是配置不对，而不是悄悄不用）。 */
const IngestModelSchema = Type.Object(
    {
        baseUrl: Type.String({minLength: 1}),
        id: Type.String({minLength: 1}),
        apiKeyEnv: Type.String({minLength: 1}),
        contextWindow: Type.Optional(Type.Integer({minimum: 1})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1})),
        price: Type.Optional(PriceSchema),
    },
    {additionalProperties: false},
);

const ConfigSchema = Type.Object({
    model: Type.Object({
        baseUrl: Type.String({minLength: 1}),
        id: Type.String({minLength: 1}),
        apiKeyEnv: Type.String({minLength: 1}),
        contextWindow: Type.Optional(Type.Integer({minimum: 1})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1})),
        thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")])),
        price: Type.Optional(PriceSchema),
    }),
    ingest: Type.Optional(
        Type.Object({
            model: Type.Optional(IngestModelSchema),
            // 挑选相关说法（docs/specs/story/ingest.md 输出 4）：默认关；开着时用 `model`，没写就用抽取的模型。
            recall: Type.Optional(Type.Object({enabled: Type.Optional(Type.Boolean()), model: Type.Optional(IngestModelSchema)}, {additionalProperties: false})),
        }),
    ),
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

/** 按配置的 schema 校验；不对时报 `qa_unconfigured`，写明是哪个字段（最多三处）。`source` 说明这份配置从哪来。 */
export function parseQaConfig(value: unknown, source: string): QaConfig {
    if (!checkConfig.Check(value)) {
        const problems = [...checkConfig.Errors(value)].slice(0, 3).map(item => `${item.instancePath || "/"} ${item.message}`);
        throw new QaError("qa_unconfigured", `问答配置${source}不对：${problems.join("；")}`);
    }
    return value;
}

/** 读并校验配置；文件不在、不是 JSON 或字段不对都报 `qa_unconfigured`，写明是哪个字段。 */
export async function loadQaConfig(path: string = defaultConfigPath()): Promise<QaConfig> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        throw new QaError("qa_unconfigured", `读不到问答配置 ${path}：先用 nbstory config init 写好它（字段见 docs/specs/story/qa.md 的“配置”）`, {cause: error});
    }
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new QaError("qa_unconfigured", `问答配置 ${path} 不是 JSON`, {cause: error});
    }
    return parseQaConfig(value, ` ${path} `);
}

/**
 * 校验后写盘。先写同目录的临时文件再改名，读者（正在跑的 `ask`）要么读到旧的整份，要么读到新的整份；校验不过
 * 或写失败时原文件不动。密钥不在配置里（只有环境变量名），所以文件用普通权限。
 */
export async function saveQaConfig(path: string, config: unknown): Promise<QaConfig> {
    const valid = parseQaConfig(config, ` ${path} `);
    const temporary = `${path}.${process.pid}.tmp`;
    const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
    const failed = (error: unknown, note = ""): QaError => new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${reason(error)}${note}`, {cause: error});
    try {
        await mkdir(dirname(path), {recursive: true});
    } catch (error) {
        throw failed(error);
    }
    let created = false;
    try {
        await writeFile(temporary, `${JSON.stringify(valid, null, 4)}\n`);
        created = true;
        await rename(temporary, path);
    } catch (error) {
        // 原文件没动过。临时文件写出来了就清理；清理也失败时照样报写失败，不让清理的错误盖掉它，留下的临时文件写进说明。
        const leftover = created ? await rm(temporary, {force: true}).then(() => null, (cleanup: unknown) => cleanup) : null;
        throw failed(error, leftover === null ? "" : `；临时文件 ${temporary} 没能删掉：${reason(leftover)}`);
    }
    return valid;
}

export function qaLimits(config: QaConfig): {maxChapters: number; fullReadMaxChars: number} {
    return {maxChapters: config.qa?.maxChapters ?? MAX_CHAPTERS, fullReadMaxChars: config.qa?.fullReadMaxChars ?? DEFAULT_FULL_READ_MAX_CHARS};
}

/** 抽取一次请求的输出上限，配置里没写 `maxTokens` 时用（与抽取管线定型时相同）。 */
export const DEFAULT_INGEST_MAX_TOKENS = 32_000;

export interface IngestModel {
    baseUrl: string;
    id: string;
    apiKeyEnv: string;
    maxTokens: number;
    price: Static<typeof PriceSchema> | null;
    /** 取自哪一节：`ingest.model`，或没有它时的问答 `model`。 */
    source: "ingest.model" | "model";
}

/** 挑选相关说法用的模型；多一种来源 `ingest.recall.model`。 */
export type RecallModel = Omit<IngestModel, "source"> & {source: IngestModel["source"] | "ingest.recall.model"};

/** 抽取用的模型：`ingest.model`，没有时用问答的 `model`（其中的 `thinking` 不用）。 */
export function ingestModel(config: QaConfig): IngestModel {
    const own = config.ingest?.model;
    return {...asModel(own ?? config.model), source: own ? "ingest.model" : "model"};
}

/** 挑选相关说法用的模型；没开（默认）时为 null。整节继承：`ingest.recall.model`，没有时用抽取的模型。 */
export function recallModel(config: QaConfig): RecallModel | null {
    const recall = config.ingest?.recall;
    if (recall?.enabled !== true) return null;
    return recall.model ? {...asModel(recall.model), source: "ingest.recall.model"} : ingestModel(config);
}

function asModel(model: Static<typeof IngestModelSchema> | QaConfig["model"]): Omit<IngestModel, "source"> {
    return {baseUrl: model.baseUrl, id: model.id, apiKeyEnv: model.apiKeyEnv, maxTokens: model.maxTokens ?? DEFAULT_INGEST_MAX_TOKENS, price: model.price ?? null};
}
