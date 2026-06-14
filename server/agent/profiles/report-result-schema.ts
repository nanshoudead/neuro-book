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
 */
export function reportResultSchemaForProfile(profile: AgentProfile): TSchema {
    const reportBinding = profile.tools.report_result;
    const dataSchema = isReportResultBinding(reportBinding) ? reportBinding.dataSchema ?? profile.outputSchema : profile.outputSchema;
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...isEmptyObjectSchema(dataSchema)
            ? {}
            : {
                data: Type.Optional(dataSchema as TSchema),
            },
    };
    return Type.Object(properties);
}

/**
 * 从目标 profile 的 sidecarDataSchema 派生 report_sidecar_result 的模型可见参数 schema。
 *
 * 注意：这里生成的是 profile-stable schema，不随当前 active sidecar 变化，避免破坏 provider tool cache。
 * 执行期仍会按当前 active sidecar 的 sidecarDataSchema 做严格校验。
 */
export function reportSidecarResultSchemaForProfile(profile: AgentProfile): TSchema {
    return Type.Object({
        result: Type.String({
            description: "旁路阶段的可读结果；写简短摘要即可。",
        }),
        data: sidecarDataUnionSchema(profile),
    });
}

/**
 * 生成当前 profile 所有 sidecarDataSchema 的稳定 union。
 */
export function sidecarDataUnionSchema(profile: AgentProfile): TSchema {
    const schemas = (profile.sidecars ?? [])
        .map((pass) => pass.sidecarDataSchema)
        .filter((schema): schema is TSchema => Boolean(schema));
    if (schemas.length === 0) {
        return Type.Never({
            description: "当前 profile 没有声明 sidecarDataSchema；不应调用 report_sidecar_result。",
        });
    }
    if (schemas.length === 1) {
        return schemas[0]!;
    }
    return Type.Union(schemas, {
        description: "当前 profile 所有 sidecarDataSchema 的稳定 union；当前旁路的精确结构以 sidecar reminder 为准。",
    });
}

function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && binding.key === "report_result" && "dataSchema" in binding);
}
