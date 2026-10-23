/**
 * 问答与抽取共用的配置文件的格式（docs/specs/story/qa.md 的“配置”、docs/specs/story/ingest.md 的“抽取模型”）。单独成
 * 文件、不碰 node：读写配置的 `qa/config.ts`（命令行与服务端）和网页的设置页（`SchemaForm` 按它画表单）用同一份。
 * `x-form` 是设置页的界面提示（docs/specs/ui/forms.md），校验不看它。
 *
 * 校验在这里就拦住两类错：
 * - 存密钥的环境变量名只能是变量名的写法：把密钥本身贴进来，密钥就落进配置文件、又被读回显示（qa 输出 19、20）。命令行
 *   的字段编辑另有一条给人看的说明（`config-edit.ts` 的 `envNameProblem`），整份写入（网页设置页）靠这里；
 * - 不认识的字段一律不收，免得把别的东西（包括贴错位置的密钥）原样存下来。
 */

import {Type, type Static} from "typebox";

/** 环境变量名的写法（与 `qa/config-edit.ts` 的 `ENV_NAME` 相同）。 */
export const ENV_NAME_PATTERN = "^[A-Za-z_][A-Za-z0-9_]*$";

const apiKeyEnv = () => Type.String({minLength: 1, pattern: ENV_NAME_PATTERN, "x-form": {label: "密钥环境变量", help: "存密钥的环境变量名（例如 OPENAI_API_KEY），不是密钥本身；服务启动时读它"}});
const baseUrl = () => Type.String({minLength: 1, "x-form": {label: "服务地址", placeholder: "https://api.example.com/v1"}});
const modelId = () => Type.String({minLength: 1, "x-form": {label: "模型名"}});

export const PriceSchema = Type.Object(
    {
        input: Type.Number({minimum: 0, "x-form": {label: "输入单价", unit: "每百万 token"}}),
        output: Type.Number({minimum: 0, "x-form": {label: "输出单价", unit: "每百万 token"}}),
        cacheRead: Type.Optional(Type.Number({minimum: 0, "x-form": {label: "缓存读单价", unit: "每百万 token"}})),
        currency: Type.String({minLength: 1, "x-form": {label: "币种"}}),
    },
    {additionalProperties: false, "x-form": {label: "单价"}},
);

/** 抽取用的一个模型。推理档由程序按步骤固定，所以不收 `thinking`（写了就是配置不对，而不是悄悄不用）。 */
const ingestModelSchema = (form?: {label: string; help: string}) =>
    Type.Object(
        {
            baseUrl: baseUrl(),
            id: modelId(),
            apiKeyEnv: apiKeyEnv(),
            contextWindow: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "上下文窗口", unit: "token"}})),
            maxTokens: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "单次输出上限", unit: "token"}})),
            price: Type.Optional(PriceSchema),
        },
        {additionalProperties: false, ...(form === undefined ? {} : {"x-form": form})},
    );

export const IngestModelSchema = ingestModelSchema();

export const ConfigSchema = Type.Object(
    {
        model: Type.Object(
            {
                baseUrl: baseUrl(),
                id: modelId(),
                apiKeyEnv: apiKeyEnv(),
                contextWindow: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "上下文窗口", unit: "token"}})),
                maxTokens: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "单次输出上限", unit: "token"}})),
                thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")], {"x-form": {label: "推理档"}})),
                price: Type.Optional(PriceSchema),
            },
            {additionalProperties: false, "x-form": {label: "问答模型"}},
        ),
        ingest: Type.Optional(
            Type.Object(
                {
                    model: Type.Optional(ingestModelSchema({label: "抽取模型", help: "不写时用问答模型"})),
                    // 挑选相关说法（docs/specs/story/ingest.md 输出 4）：默认关；开着时用 `model`，没写就用抽取的模型。
                    recall: Type.Optional(
                        Type.Object(
                            {
                                enabled: Type.Optional(Type.Boolean({"x-form": {label: "挑选相关说法"}})),
                                model: Type.Optional(ingestModelSchema({label: "挑选用的模型", help: "不写时用抽取模型"})),
                            },
                            {additionalProperties: false, "x-form": {label: "挑选相关说法"}},
                        ),
                    ),
                },
                {additionalProperties: false, "x-form": {label: "抽取"}},
            ),
        ),
        qa: Type.Optional(
            Type.Object(
                {
                    maxChapters: Type.Optional(Type.Integer({minimum: 1, maximum: 20, "x-form": {label: "一问最多读的章数", help: "图当目录做法下，一问新读的不同章数上限（最多 20）"}})),
                    fullReadMaxChars: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "全读的原文上限", unit: "字"}})),
                },
                {additionalProperties: false, "x-form": {label: "问答"}},
            ),
        ),
    },
    {additionalProperties: false},
);

export type QaConfig = Static<typeof ConfigSchema>;
