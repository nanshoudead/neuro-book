import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import type {ProfileToolBinding, ReportResultToolBinding} from "nbook/server/agent/tools/types";

/**
 * 判断 TypeBox object schema 是否没有定义任何输出字段。
 */
export function isEmptyObjectSchema(schema: TSchema | undefined): boolean {
    if (!schema || typeof schema !== "object") {
        return true;
    }
    const properties = "properties" in schema && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
    return Object.keys(properties).length === 0;
}

/**
 * 从目标 profile 的 OutputSchema 派生 report_result 的模型可见参数 schema。
 * sidecar_data 字段使用具名属性对象（key = sidecar name），避免 union 歧义，保证 schema 在所有 phase 稳定。
 */
export function reportResultSchemaForProfile(profile: AgentProfile): TSchema {
    const reportBinding = profile.tools.report_result;
    const dataSchema = isReportResultBinding(reportBinding) ? reportBinding.dataSchema ?? profile.outputSchema : profile.outputSchema;
    const sidecarProperties: Record<string, TSchema> = {};
    for (const pass of profile.sidecars ?? []) {
        if (pass.sidecarDataSchema) {
            sidecarProperties[pass.name] = Type.Optional(pass.sidecarDataSchema);
        }
    }
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...isEmptyObjectSchema(dataSchema)
            ? {}
            : {
                data: Type.Optional(dataSchema as TSchema),
            },
        ...Object.keys(sidecarProperties).length > 0
            ? {
                sidecar_data: Type.Optional(Type.Object(sidecarProperties, {
                    description: "旁路结果对象；key 为 sidecar name，每个旁路阶段只填自己的 key。主路调用不要使用。",
                })),
            }
            : {},
    };
    return Type.Object(properties);
}

function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && "dataSchema" in binding);
}
