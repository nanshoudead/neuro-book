import type {AgentTool, JsonValue} from "nbook/server/agent/messages/types";
import type {TSchema} from "typebox";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import type {ProfileVariableAccessor} from "nbook/server/agent/variables/types";

export type ToolExecutionMode = "sequential" | "parallel";

export type ToolExecutionContext = {
    harness: NeuroAgentHarness;
    sessionId: number;
    parentSessionId?: number;
    profileKey: string;
    workspaceRoot: string;
    workspaceKey: string;
    projectPath?: string;
    invocationId?: string;
    vars?: ProfileVariableAccessor;
    sessionWrites?: ToolSessionWriteSink;
};

export type NeuroAgentTool = AgentTool<any, any> & {
    key: string;
    approvalRequired?: boolean;
    /** 为空时使用 parameters 校验；非空时 provider-visible parameters 和执行校验 schema 可以分离。 */
    validationSchema?: TSchema;
    /**
     * 同一 assistant turn 内的工具调度策略。未声明时由 harness 默认策略决定。
     */
    executionMode?: ToolExecutionMode;
    /**
     * v3 harness 自己执行工具时使用的上下文入口。Pi 的 AgentTool.execute 没有当前 session 信息，
     * 所以需要把 Neuro Book 的 session/link 语义保留在这一层。
     */
    executeWithContext?: (
        context: ToolExecutionContext,
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: Parameters<AgentTool<any, any>["execute"]>[3],
    ) => ReturnType<AgentTool<any, any>["execute"]>;
};

export type ToolBinding<TKey extends string = string> = {
    key: TKey;
    /** 非空表示 profile 自带工具；为空时从全局 registry 解析。 */
    definition?: AgentToolDefinition<TKey>;
    /** 为空时使用工具定义或全局工具的默认参数 schema。 */
    parameters?: TSchema;
    /** 为空时使用 parameters 做执行前校验。 */
    validationSchema?: TSchema;
    /** 为空时使用工具定义或全局工具描述。 */
    description?: string;
};

export type ReportResultToolBinding = ToolBinding<"report_result"> & {
    /** 主路 report_result.data 的结构化 schema。 */
    dataSchema?: TSchema;
};

export type ReportSidecarResultToolBinding = ToolBinding<"report_sidecar_result">;

export type ProfileToolBinding<TKey extends string = string> = ToolBinding<TKey> | AgentToolDefinition<TKey> | ReportResultToolBinding | ReportSidecarResultToolBinding;

export type ProfileTools = Record<string, ProfileToolBinding>;

export type AgentToolDefinitionInput<TKey extends string = string> = {
    key: TKey;
    name?: string;
    label?: string;
    description: string;
    parameters: TSchema;
    validationSchema?: TSchema;
    approvalRequired?: boolean;
    executionMode?: ToolExecutionMode;
    prepareArguments?: NeuroAgentTool["prepareArguments"];
    execute?: NeuroAgentTool["execute"];
    executeWithContext?: NeuroAgentTool["executeWithContext"];
};

export type ToolBindOptions<TKey extends string = string> = Omit<ToolBinding<TKey>, "key" | "definition">;

export type AgentToolDefinition<TKey extends string = string> = AgentToolDefinitionInput<TKey> & {
    bind(options?: ToolBindOptions<TKey>): ToolBinding<TKey>;
    runtime(options?: ToolBindOptions<TKey>): NeuroAgentTool;
};

/**
 * 定义一个 Agent 工具。definition 是 key/schema/description/execute 的唯一真相源；
 * profile 可通过 bind() 引用，也可直接把 definition 放进 tools 作为自带工具。
 */
export function defineAgentTool<const TKey extends string>(input: AgentToolDefinitionInput<TKey>): AgentToolDefinition<TKey> {
    const definition: AgentToolDefinition<TKey> = {
        ...input,
        bind(options = {}) {
            return {
                key: input.key,
                definition,
                ...options,
            };
        },
        runtime(options = {}) {
            return {
                key: input.key,
                name: input.name ?? input.key,
                label: input.label ?? input.name ?? input.key,
                description: options.description ?? input.description,
                parameters: options.parameters ?? input.parameters,
                validationSchema: options.validationSchema ?? input.validationSchema,
                approvalRequired: input.approvalRequired,
                executionMode: input.executionMode,
                prepareArguments: input.prepareArguments,
                execute: input.execute ?? (async () => {
                    throw new Error(`${input.key} 必须在 agent session context 内执行。`);
                }),
                executeWithContext: input.executeWithContext,
            };
        },
    };
    return definition;
}

/**
 * 将现有 NeuroAgentTool 包装成 definition。用于渐进迁移旧工具模块，保持执行行为不变。
 */
export function defineAgentToolFromRuntime<const TKey extends string>(tool: NeuroAgentTool & {key: TKey}): AgentToolDefinition<TKey> {
    return defineAgentTool({
        key: tool.key,
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        validationSchema: tool.validationSchema,
        approvalRequired: tool.approvalRequired,
        executionMode: tool.executionMode,
        prepareArguments: tool.prepareArguments,
        execute: tool.execute,
        executeWithContext: tool.executeWithContext,
    });
}

export function isAgentToolDefinition(value: ProfileToolBinding | undefined): value is AgentToolDefinition {
    return Boolean(value && typeof value === "object" && "runtime" in value && typeof value.runtime === "function");
}

export type ToolApprovalResolution = {
    kind: "tool_approval";
    toolCallId: string;
    approved: boolean;
    resultText?: string;
    data?: JsonValue;
    answers?: UserInputResolution["answers"];
};

export type UserInputResolution = {
    kind: "user_input";
    toolCallId: string;
    answers: Array<{
        questionIndex: number;
        text: string;
        selectedOptionIndex?: number;
        selectedOptionIndexes?: number[];
        note?: string;
        ignored?: boolean;
    }>;
};

export type AgentResolution = ToolApprovalResolution | UserInputResolution;
