import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";

export const ReportResultSchema = Type.Object({
    result: Type.String(),
    data: Type.Optional(Type.Unknown()),
    sidecar_data: Type.Optional(Type.Unknown()),
});

const RequestUserInputQuestionOptionSchema = Type.Object({
    label: Type.String({description: "User-facing option label, preferably 1-5 words."}),
    description: Type.Optional(Type.String({description: "Optional short sentence explaining the impact or tradeoff of this option."})),
    recommended: Type.Optional(Type.Boolean({description: "Whether this option is visually marked as recommended."})),
    defaultSelected: Type.Optional(Type.Boolean({description: "Whether this option should be selected by default when the prompt opens."})),
});

const RequestUserInputQuestionSchema = Type.Object({
    header: Type.Optional(Type.String({description: "Short header shown above this question."})),
    question: Type.String({description: "Prompt shown to the user."}),
    options: Type.Optional(Type.Array(RequestUserInputQuestionOptionSchema, {description: "Options for this question. Omit or pass an empty array for open-ended questions."})),
    multiSelect: Type.Optional(Type.Boolean({description: "Whether the user may select multiple options. Ignored when options is empty."})),
    defaultOptionIndex: Type.Optional(Type.Integer({minimum: -1, description: "Default selected option index for single-select questions. -1 selects the alternative answer option."})),
    defaultOptionIndexes: Type.Optional(Type.Array(Type.Integer({minimum: -1}), {description: "Default selected option indexes for multi-select questions. -1 selects the alternative answer option."})),
});

const RequestUserInputSchema = Type.Object({
    questions: Type.Array(RequestUserInputQuestionSchema, {minItems: 1, description: "Questions to ask in one user-input request."}),
});

const PlanModeSchema = Type.Object({
    reason: Type.Optional(Type.String({description: "Short reason shown to the user for this Plan Mode transition."})),
    planFilePath: Type.Optional(Type.String({description: "For exit_plan_mode only. Optional Project Workspace relative Markdown file under .agent/plan/, for example .agent/plan/profile-migration.md."})),
});

export const controlTools = {
    reportResult: defineAgentTool({
        key: "report_result",
        name: "report_result",
        label: "Report Result",
        executionMode: "sequential",
        description: "Report final agent result to the caller.",
        parameters: ReportResultSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as Static<typeof ReportResultSchema>;
            return {
                content: [{type: "text", text: report.result}],
                details: report,
                terminate: true,
            };
        },
    }),
    requestUserInput: defineAgentTool({
        key: "request_user_input",
        name: "request_user_input",
        label: "Request User Input",
        executionMode: "sequential",
        approvalRequired: true,
        description: "Ask the user for input and wait for continue resolution.",
        parameters: RequestUserInputSchema,
        async execute() {
            return {
                content: [{type: "text", text: "等待用户输入。"}],
                details: {pending: true},
                terminate: true,
            };
        },
    }),
    enterPlanMode: defineAgentTool({
        key: "enter_plan_mode",
        name: "enter_plan_mode",
        label: "Enter Plan Mode",
        executionMode: "sequential",
        approvalRequired: true,
        description: "Request entering plan mode.",
        parameters: PlanModeSchema,
        async execute(_toolCallId, params: unknown) {
            const plan = params as Static<typeof PlanModeSchema>;
            return {
                content: [{type: "text", text: plan.reason ? `请求进入计划模式：${plan.reason}` : "请求进入计划模式。"}],
                details: {pending: true},
                terminate: true,
            };
        },
    }),
    exitPlanMode: defineAgentTool({
        key: "exit_plan_mode",
        name: "exit_plan_mode",
        label: "Exit Plan Mode",
        executionMode: "sequential",
        approvalRequired: true,
        description: "Request exiting plan mode. Optionally pass planFilePath for a Project Workspace relative Markdown file under .agent/plan/ so the approval UI can preview it.",
        parameters: PlanModeSchema,
        async execute(_toolCallId, params: unknown) {
            const plan = params as Static<typeof PlanModeSchema>;
            return {
                content: [{type: "text", text: plan.reason ? `请求退出计划模式：${plan.reason}` : "请求退出计划模式。"}],
                details: {pending: true},
                terminate: true,
            };
        },
    }),
} as const;

/**
 * 创建带当前 profile OutputSchema 的 report_result 工具。
 */
export function createReportResultTool(parameters: TSchema, options: {
    dataSchema?: TSchema;
    activeSidecar?: {
        name: string;
        sidecarDataSchema?: TSchema;
    };
} = {}): NeuroAgentTool {
    return {
        key: "report_result",
        name: "report_result",
        label: "Report Result",
        executionMode: "sequential",
        description: "Report final agent result to the caller.",
        parameters,
        validationSchema: ReportResultSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as {result: string; data?: unknown; sidecar_data?: Record<string, unknown>};
            if (options.activeSidecar) {
                if ("data" in report) {
                    throw new Error(`sidecar ${options.activeSidecar.name} 不能通过 report_result.data 返回旁路结果，请改用 sidecar_data["${options.activeSidecar.name}"]。`);
                }
                const sidecarFieldData = report.sidecar_data?.[options.activeSidecar.name];
                if (sidecarFieldData === undefined) {
                    throw new Error(`sidecar ${options.activeSidecar.name} 必须通过 report_result.sidecar_data["${options.activeSidecar.name}"] 返回旁路结果。`);
                }
                if (options.activeSidecar.sidecarDataSchema) {
                    try {
                        assertStrictSchemaValue(options.activeSidecar.sidecarDataSchema, sidecarFieldData);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        throw new Error(`sidecar ${options.activeSidecar.name} sidecar_data 校验失败：${message}`);
                    }
                }
            } else if ("sidecar_data" in report) {
                throw new Error("主 run 不能通过 report_result.sidecar_data 返回结果，请改用 data 或 result。");
            }
            if (options.dataSchema && "data" in report) {
                try {
                    assertStrictSchemaValue(options.dataSchema, report.data);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`report_result.data 校验失败：${message}`);
                }
            }
            return {
                content: [{type: "text", text: report.result}],
                details: report,
                terminate: true,
            };
        },
    };
}

/**
 * 严格校验 schema，不执行 TypeBox Parse/Convert，避免把模型错误参数静默修正。
 */
function assertStrictSchemaValue(schema: TSchema, value: unknown): void {
    if (Value.Check(schema, value)) {
        return;
    }
    const errors = [...Value.Errors(schema, value)]
        .map((error) => error.message)
        .join("; ");
    throw new Error(errors || "Parse");
}
